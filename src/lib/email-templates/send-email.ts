import * as React from 'react'
import { render } from '@react-email/render'
import { TEMPLATES } from './registry'

// Server-only: reads BREVO_API_KEY. Never import from client components.

const SITE_NAME = process.env['EMAIL_FROM_NAME'] || 'Conferência Rápida'
// Domínio remetente autenticado no Brevo (registros DKIM/SPF no DNS).
const FROM_DOMAIN = process.env['EMAIL_FROM_DOMAIN'] || 'conferenciarapida.com.br'
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

export type SendTemplateEmailResult =
  | { sent: true }
  | { sent: false; reason: 'recipient_suppressed' }

export interface SendTemplateEmailOptions {
  templateData?: Record<string, any>
  /** Dedupes retries of the same logical send; defaults to a random UUID (no dedupe). */
  idempotencyKey?: string
  replyTo?: string
}

/** Erro da API do Brevo, com o código e o status HTTP para diagnóstico. */
export class EmailAPIError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message)
    this.name = 'EmailAPIError'
  }
}

/**
 * Renders a registered template and sends it through Brevo's transactional
 * email API. A blocked/unsubscribed recipient is an expected outcome
 * ({ sent: false }); any other failure throws EmailAPIError.
 */
export async function sendTemplateEmail(
  templateName: string,
  to: string,
  options: SendTemplateEmailOptions = {}
): Promise<SendTemplateEmailResult> {
  const apiKey = process.env['BREVO_API_KEY']
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured')
  }

  const template = TEMPLATES[templateName]
  if (!template) {
    throw new Error(
      `Template '${templateName}' not found. Available: ${Object.keys(TEMPLATES).join(', ')}`
    )
  }

  // Template-level `to` takes precedence — notification templates always
  // send to their fixed address.
  const recipient = template.to || to
  if (!recipient) {
    throw new Error('Recipient is required (the template defines no fixed recipient)')
  }

  const templateData = options.templateData ?? {}
  const element = React.createElement(template.component, templateData)
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  const resposta = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: SITE_NAME, email: `nao-responda@${FROM_DOMAIN}` },
      to: [{ email: recipient }],
      subject,
      htmlContent: html,
      textContent: text,
      replyTo: options.replyTo ? { email: options.replyTo } : undefined,
      tags: [templateName],
      headers: { 'X-Idempotency-Key': options.idempotencyKey || crypto.randomUUID() },
    }),
  })

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { code?: string; message?: string }
    const code = corpo.code ?? 'brevo_error'
    const mensagem = corpo.message ?? `Brevo respondeu ${resposta.status}`
    if (/blacklist|blocked|unsubscribed/i.test(mensagem)) {
      return { sent: false, reason: 'recipient_suppressed' }
    }
    throw new EmailAPIError(mensagem, code, resposta.status)
  }

  return { sent: true }
}
