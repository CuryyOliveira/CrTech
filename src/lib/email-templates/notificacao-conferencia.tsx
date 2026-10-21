import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

export interface NotificacaoConferenciaEmailProps {
  assunto?: string
  titulo?: string
  introducao?: string
  detalhes?: Array<{ rotulo: string; valor: string }>
  divergencias?: Array<{
    codigo?: string | null
    descricao?: string | null
    esperada?: number | null
    encontrada?: number | null
  }>
}

function NotificacaoConferenciaEmail({
  titulo = 'Notificação operacional',
  introducao = 'Há uma nova atualização de conferência.',
  detalhes = [],
  divergencias = [],
}: NotificacaoConferenciaEmailProps) {
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{introducao}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brand}>CM&nbsp;&nbsp; Conferência de Materiais</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>{titulo}</Heading>
            <Text style={intro}>{introducao}</Text>
            {detalhes.map((item) => (
              <Section key={`${item.rotulo}-${item.valor}`} style={row}>
                <Text style={label}>{item.rotulo}</Text>
                <Text style={value}>{item.valor}</Text>
              </Section>
            ))}
            {divergencias.length > 0 && (
              <Section style={divergenceBlock}>
                <Heading as="h2" style={subheading}>
                  Divergências encontradas ({divergencias.length})
                </Heading>
                {divergencias.map((item, index) => (
                  <Text key={`${item.codigo ?? 'item'}-${index}`} style={divergenceItem}>
                    {item.codigo ?? '—'} · {item.descricao ?? 'Material'} · esperada{' '}
                    {item.esperada ?? '—'} · encontrada {item.encontrada ?? '—'}
                  </Text>
                ))}
              </Section>
            )}
            <Text style={note}>
              Acesse a Central Administrativa para acompanhar em tempo real.
            </Text>
          </Section>
          <Hr style={divider} />
          <Text style={footer}>
            Conferência de Materiais · Este é um e-mail automático. Não responda.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: NotificacaoConferenciaEmail,
  subject: (data) => String(data['assunto'] ?? 'Notificação — Conferência de Materiais'),
  displayName: 'Notificação de conferência',
  previewData: {
    assunto: 'TESTE — Conferência de Materiais',
    titulo: 'CONEXÃO DE E-MAIL VALIDADA',
    introducao: 'O canal de notificações está pronto para uso.',
    detalhes: [{ rotulo: 'Status', valor: 'Envio de teste concluído' }],
  },
} satisfies TemplateEntry

const body = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0 }
const container = { border: '1px solid #e4e4e7', borderRadius: '8px', margin: '24px auto', maxWidth: '600px', overflow: 'hidden' }
const header = { backgroundColor: '#ea580c', padding: '18px 24px' }
const brand = { color: '#ffffff', fontSize: '16px', fontWeight: 700, margin: 0 }
const content = { padding: '24px' }
const heading = { color: '#ea580c', fontSize: '19px', margin: '0 0 6px', textTransform: 'uppercase' as const }
const intro = { color: '#52525b', fontSize: '14px', margin: '0 0 18px' }
const row = { borderBottom: '1px solid #e4e4e7', padding: '10px 12px' }
const label = { color: '#71717a', fontSize: '12px', margin: '0 0 3px' }
const value = { color: '#18181b', fontSize: '13px', margin: 0 }
const divergenceBlock = { marginTop: '22px' }
const subheading = { color: '#dc2626', fontSize: '15px', margin: '0 0 8px' }
const divergenceItem = { borderBottom: '1px solid #f1f1f4', color: '#18181b', fontSize: '12px', margin: 0, padding: '8px 0' }
const note = { color: '#52525b', fontSize: '13px', margin: '22px 0 0' }
const divider = { borderColor: '#e4e4e7', margin: 0 }
const footer = { backgroundColor: '#f4f4f5', color: '#71717a', fontSize: '11px', margin: 0, padding: '16px 24px' }