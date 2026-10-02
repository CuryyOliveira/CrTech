import {
  Body,
  Button,
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

export interface ItemDivergente {
  codigo?: string | null
  descricao?: string | null
  esperada?: number | null
  encontrada?: number | null
}

export interface ConferenciaConcluidaEmailProps {
  nome?: string
  responsavel?: string
  lista?: string
  unidadeLocal?: string
  status?: string
  pendentes?: string
  itensDivergentes?: ItemDivergente[]
  usuario?: string
  conferente?: string
  matricula?: string
  frota?: string
  local?: string
  tipoConferencia?: string
  inicio?: string
  fim?: string
  duracao?: string
  conferenciaId?: string
  previstos?: string
  contados?: string
  divergentes?: string
  faltantes?: string
  sobras?: string
  percentual?: string
  urlRelatorio?: string
}

const dash = (valor?: string) => (valor && valor.trim() ? valor : '—')

function ConferenciaConcluidaEmail({
  nome,
  responsavel,
  lista,
  unidadeLocal,
  status,
  pendentes,
  itensDivergentes,
  usuario,
  conferente,
  matricula,
  frota,
  local,
  tipoConferencia,
  inicio,
  fim,
  duracao,
  conferenciaId,
  previstos,
  contados,
  divergentes,
  faltantes,
  sobras,
  percentual,
  urlRelatorio,
}: ConferenciaConcluidaEmailProps) {
  const linhas: Array<[string, string | undefined]> = [
    ['Status', status || 'Concluída'],
    ['Responsável', responsavel],
    ['Conferente', conferente],
    ['Lista', lista || nome],
    ['Unidade/Local', unidadeLocal || local],
    // Frota somente quando cadastrada.
    ...(frota && frota.trim() ? ([['Frota', frota]] as Array<[string, string]>) : []),
    ['Início', inicio],
    ['Término', fim],
    ['Tempo total', duracao],
    ['Usuário', usuario],
    ['Matrícula', matricula],
    ['Tipo de conferência', tipoConferencia],
    ['ID da conferência', conferenciaId],
  ]

  const metricas: Array<[string, string | undefined]> = [
    ['📦 Quantidade de itens', previstos],
    ['✅ Corretos', contados],
    ['⚠️ Divergências', divergentes],
    ...(pendentes && pendentes !== '0'
      ? ([['Não contados', pendentes]] as Array<[string, string]>)
      : []),
    ['Itens faltantes', faltantes],
    ['Itens em excesso', sobras],
    ['Percentual de acuracidade', percentual],
  ]
  const divergencias = itensDivergentes ?? []

  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{`Conferência concluída — ${dash(nome)}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={brand}>✅ CONFERÊNCIA CONCLUÍDA</Text>
            <Text style={brandSub}>CM · Conferência de Materiais</Text>
          </Section>
          <Section style={content}>
            <Heading style={heading}>{dash(nome)}</Heading>
            <Text style={intro}>
              A conferência foi finalizada com sucesso e os dados já estão disponíveis na Central
              Administrativa.
            </Text>
            {linhas.map(([rotulo, valor]) => (
              <Section key={rotulo} style={row}>
                <Text style={label}>{rotulo}</Text>
                <Text style={value}>{dash(valor)}</Text>
              </Section>
            ))}
            <Heading as="h2" style={subheading}>
              Resultado da contagem
            </Heading>
            {metricas.map(([rotulo, valor]) => (
              <Section key={rotulo} style={row}>
                <Text style={label}>{rotulo}</Text>
                <Text style={value}>{dash(valor)}</Text>
              </Section>
            ))}
            {divergencias.length ? (
              <>
                <Heading as="h2" style={subheading}>
                  Itens com divergência
                </Heading>
                {divergencias.map((d, i) => (
                  <Section key={`${d.codigo ?? ''}-${i}`} style={row}>
                    <Text style={label}>
                      {dash(d.codigo ?? undefined)} — {dash(d.descricao ?? undefined)}
                    </Text>
                    <Text style={value}>
                      Esperada: {d.esperada ?? '—'} · Encontrada: {d.encontrada ?? '—'}
                      {d.esperada != null && d.encontrada != null
                        ? ` · Diferença: ${d.encontrada - d.esperada > 0 ? '+' : ''}${d.encontrada - d.esperada}`
                        : ''}
                    </Text>
                  </Section>
                ))}
              </>
            ) : null}
            {urlRelatorio ? (
              <Section style={ctaBlock}>
                <Button href={urlRelatorio} style={cta}>
                  Abrir relatório no painel
                </Button>
              </Section>
            ) : null}
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
  component: ConferenciaConcluidaEmail,
  subject: (data) => `✅ Conferência concluída – ${dash(String(data['nome'] ?? ''))}`,
  displayName: 'Conferência concluída',
  previewData: {
    nome: 'Frota 1204 — Caminhão Munck',
    responsavel: 'Fernando Guedis',
    lista: 'Frota 1204 — Caminhão Munck',
    unidadeLocal: 'Alcoeste · Frota de Caminhões',
    status: 'Concluída',
    itensDivergentes: [{ codigo: '02779-5', descricao: 'PILHA ENERGIZER D2009', esperada: 11, encontrada: 9 }],
    usuario: 'Lucas Arantes',
    conferente: 'Lucas Arantes',
    matricula: '10425',
    frota: '1204',
    local: 'Oficina Central',
    tipoConferencia: 'Estoque',
    inicio: '01/08/2026 08:12',
    fim: '01/08/2026 09:03',
    duracao: '51min 12s',
    conferenciaId: '19efd962-2a4e-477d-a6e2-6d5c2d4cee3b',
    previstos: '120',
    contados: '120',
    divergentes: '3',
    faltantes: '2',
    sobras: '1',
    percentual: '97,5%',
    urlRelatorio: 'https://conferenciarapida.com.br/admin/notificacoes',
  },
} satisfies TemplateEntry

const body = { backgroundColor: '#ffffff', fontFamily: 'Arial, Helvetica, sans-serif', margin: 0 }
const container = {
  border: '1px solid #e4e4e7',
  borderRadius: '8px',
  margin: '24px auto',
  maxWidth: '600px',
  overflow: 'hidden',
}
const header = { backgroundColor: '#15803d', padding: '18px 24px' }
const brand = { color: '#ffffff', fontSize: '17px', fontWeight: 700, margin: 0 }
const brandSub = { color: '#dcfce7', fontSize: '12px', margin: '4px 0 0' }
const content = { padding: '24px' }
const heading = { color: '#15803d', fontSize: '19px', margin: '0 0 6px' }
const intro = { color: '#52525b', fontSize: '14px', margin: '0 0 18px' }
const row = { borderBottom: '1px solid #e4e4e7', padding: '10px 12px' }
const label = { color: '#71717a', fontSize: '12px', margin: '0 0 3px' }
const value = { color: '#18181b', fontSize: '13px', margin: 0 }
const subheading = { color: '#15803d', fontSize: '15px', margin: '22px 0 8px' }
const ctaBlock = { marginTop: '24px', textAlign: 'center' as const }
const cta = {
  backgroundColor: '#15803d',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 700,
  padding: '12px 22px',
  textDecoration: 'none',
}
const divider = { borderColor: '#e4e4e7', margin: 0 }
const footer = {
  backgroundColor: '#f4f4f5',
  color: '#71717a',
  fontSize: '11px',
  margin: 0,
  padding: '16px 24px',
}
