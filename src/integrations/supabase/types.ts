export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assinatura_pagamentos: {
        Row: {
          ambiente: string
          assinatura_id: string | null
          created_at: string
          empresa_id: string | null
          id: string
          moeda: string
          motivo_falha: string | null
          ocorrido_em: string
          payload: Json
          provider: string
          provider_invoice_numero: string | null
          provider_transaction_id: string | null
          status: string
          url_recibo: string | null
          valor_centavos: number | null
        }
        Insert: {
          ambiente?: string
          assinatura_id?: string | null
          created_at?: string
          empresa_id?: string | null
          id?: string
          moeda?: string
          motivo_falha?: string | null
          ocorrido_em?: string
          payload?: Json
          provider?: string
          provider_invoice_numero?: string | null
          provider_transaction_id?: string | null
          status: string
          url_recibo?: string | null
          valor_centavos?: number | null
        }
        Update: {
          ambiente?: string
          assinatura_id?: string | null
          created_at?: string
          empresa_id?: string | null
          id?: string
          moeda?: string
          motivo_falha?: string | null
          ocorrido_em?: string
          payload?: Json
          provider?: string
          provider_invoice_numero?: string | null
          provider_transaction_id?: string | null
          status?: string
          url_recibo?: string | null
          valor_centavos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assinatura_pagamentos_assinatura_id_fkey"
            columns: ["assinatura_id"]
            isOneToOne: false
            referencedRelation: "assinaturas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assinatura_pagamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      assinaturas: {
        Row: {
          ambiente: string
          cancelada_em: string | null
          cancelar_no_fim_periodo: boolean
          contratada_por: string | null
          created_at: string
          data_inicio: string | null
          empresa_id: string
          encerrada_em: string | null
          id: string
          metadata: Json
          moeda: string
          motivo_status: string | null
          periodicidade: string | null
          periodo_atual_fim: string | null
          periodo_atual_inicio: string | null
          plano_codigo: string | null
          plano_id: string | null
          provider: string
          provider_customer_id: string | null
          provider_price_id: string | null
          provider_product_id: string | null
          provider_subscription_id: string | null
          proxima_cobranca: string | null
          quantidade: number
          status: string
          trial_fim: string | null
          trial_inicio: string | null
          ultimo_evento_em: string | null
          updated_at: string
          valor_centavos: number | null
        }
        Insert: {
          ambiente?: string
          cancelada_em?: string | null
          cancelar_no_fim_periodo?: boolean
          contratada_por?: string | null
          created_at?: string
          data_inicio?: string | null
          empresa_id: string
          encerrada_em?: string | null
          id?: string
          metadata?: Json
          moeda?: string
          motivo_status?: string | null
          periodicidade?: string | null
          periodo_atual_fim?: string | null
          periodo_atual_inicio?: string | null
          plano_codigo?: string | null
          plano_id?: string | null
          provider?: string
          provider_customer_id?: string | null
          provider_price_id?: string | null
          provider_product_id?: string | null
          provider_subscription_id?: string | null
          proxima_cobranca?: string | null
          quantidade?: number
          status?: string
          trial_fim?: string | null
          trial_inicio?: string | null
          ultimo_evento_em?: string | null
          updated_at?: string
          valor_centavos?: number | null
        }
        Update: {
          ambiente?: string
          cancelada_em?: string | null
          cancelar_no_fim_periodo?: boolean
          contratada_por?: string | null
          created_at?: string
          data_inicio?: string | null
          empresa_id?: string
          encerrada_em?: string | null
          id?: string
          metadata?: Json
          moeda?: string
          motivo_status?: string | null
          periodicidade?: string | null
          periodo_atual_fim?: string | null
          periodo_atual_inicio?: string | null
          plano_codigo?: string | null
          plano_id?: string | null
          provider?: string
          provider_customer_id?: string | null
          provider_price_id?: string | null
          provider_product_id?: string | null
          provider_subscription_id?: string | null
          proxima_cobranca?: string | null
          quantidade?: number
          status?: string
          trial_fim?: string | null
          trial_inicio?: string | null
          ultimo_evento_em?: string | null
          updated_at?: string
          valor_centavos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assinaturas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assinaturas_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria: {
        Row: {
          acao: string
          created_at: string
          detalhe: string | null
          dispositivo: string | null
          id: string
          ip: string | null
          lista: string | null
          modulo: string | null
          nome: string | null
          perfil: string | null
          resultado: string
          setor: string | null
          tipo_acao: string
          user_id: string | null
          usuario: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhe?: string | null
          dispositivo?: string | null
          id?: string
          ip?: string | null
          lista?: string | null
          modulo?: string | null
          nome?: string | null
          perfil?: string | null
          resultado?: string
          setor?: string | null
          tipo_acao?: string
          user_id?: string | null
          usuario?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhe?: string | null
          dispositivo?: string | null
          id?: string
          ip?: string | null
          lista?: string | null
          modulo?: string | null
          nome?: string | null
          perfil?: string | null
          resultado?: string
          setor?: string | null
          tipo_acao?: string
          user_id?: string | null
          usuario?: string | null
        }
        Relationships: []
      }
      aviso_leituras: {
        Row: {
          aviso_id: string
          confirmado: boolean
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          aviso_id: string
          confirmado?: boolean
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          aviso_id?: string
          confirmado?: boolean
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aviso_leituras_aviso_id_fkey"
            columns: ["aviso_id"]
            isOneToOne: false
            referencedRelation: "avisos_sistema"
            referencedColumns: ["id"]
          },
        ]
      }
      avisos_sistema: {
        Row: {
          agendado_para: string | null
          arquivado: boolean
          categoria: string
          created_at: string
          created_by: string | null
          destino_perfil: string | null
          destino_setor: string | null
          exige_confirmacao: boolean
          id: string
          mensagem: string
          prioridade: string
          publicado: boolean
          titulo: string
          updated_at: string
        }
        Insert: {
          agendado_para?: string | null
          arquivado?: boolean
          categoria?: string
          created_at?: string
          created_by?: string | null
          destino_perfil?: string | null
          destino_setor?: string | null
          exige_confirmacao?: boolean
          id?: string
          mensagem: string
          prioridade?: string
          publicado?: boolean
          titulo: string
          updated_at?: string
        }
        Update: {
          agendado_para?: string | null
          arquivado?: boolean
          categoria?: string
          created_at?: string
          created_by?: string | null
          destino_perfil?: string | null
          destino_setor?: string | null
          exige_confirmacao?: boolean
          id?: string
          mensagem?: string
          prioridade?: string
          publicado?: boolean
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      cadastros_mestres: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          created_by: string | null
          descricao: string | null
          excluido: boolean
          id: string
          nome: string
          ordem: number
          tipo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          excluido?: boolean
          id?: string
          nome: string
          ordem?: number
          tipo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          excluido?: boolean
          id?: string
          nome?: string
          ordem?: number
          tipo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      conferencia_itens: {
        Row: {
          codigo: string | null
          conferencia_id: string
          descricao: string | null
          fotos: Json
          id: string
          incluido_em: string | null
          incluido_por: string | null
          incluido_por_nome: string | null
          locacao: string | null
          material_id: string | null
          motivo_inclusao: string | null
          observacoes: string | null
          origem: string
          quantidade_contada: number | null
          quantidade_esperada: number
          status: string
          updated_at: string
        }
        Insert: {
          codigo?: string | null
          conferencia_id: string
          descricao?: string | null
          fotos?: Json
          id?: string
          incluido_em?: string | null
          incluido_por?: string | null
          incluido_por_nome?: string | null
          locacao?: string | null
          material_id?: string | null
          motivo_inclusao?: string | null
          observacoes?: string | null
          origem?: string
          quantidade_contada?: number | null
          quantidade_esperada?: number
          status?: string
          updated_at?: string
        }
        Update: {
          codigo?: string | null
          conferencia_id?: string
          descricao?: string | null
          fotos?: Json
          id?: string
          incluido_em?: string | null
          incluido_por?: string | null
          incluido_por_nome?: string | null
          locacao?: string | null
          material_id?: string | null
          motivo_inclusao?: string | null
          observacoes?: string | null
          origem?: string
          quantidade_contada?: number | null
          quantidade_esperada?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conferencia_itens_conferencia_id_fkey"
            columns: ["conferencia_id"]
            isOneToOne: false
            referencedRelation: "conferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conferencia_itens_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
        ]
      }
      conferencia_pausas: {
        Row: {
          conferencia_id: string
          created_at: string
          id: string
          pausada_em: string
          retomada_em: string | null
          segundos: number | null
        }
        Insert: {
          conferencia_id: string
          created_at?: string
          id?: string
          pausada_em?: string
          retomada_em?: string | null
          segundos?: number | null
        }
        Update: {
          conferencia_id?: string
          created_at?: string
          id?: string
          pausada_em?: string
          retomada_em?: string | null
          segundos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conferencia_pausas_conferencia_id_fkey"
            columns: ["conferencia_id"]
            isOneToOne: false
            referencedRelation: "conferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      conferencias: {
        Row: {
          almoxarife: string | null
          assinatura: string | null
          assinatura_gestor: string | null
          codigo_almoxarife: string | null
          conferente: string | null
          created_at: string
          created_by: string | null
          data: string
          hora_fim: string | null
          hora_inicio: string
          id: string
          observacoes: string | null
          quantidade_pausas: number
          responsavel: string | null
          status: string
          tempo_trabalhado: number | null
          tipo: string
          total_tempo_pausado: number
          ultima_pausa: string | null
          ultima_retomada: string | null
          unidade_id: string
        }
        Insert: {
          almoxarife?: string | null
          assinatura?: string | null
          assinatura_gestor?: string | null
          codigo_almoxarife?: string | null
          conferente?: string | null
          created_at?: string
          created_by?: string | null
          data?: string
          hora_fim?: string | null
          hora_inicio?: string
          id?: string
          observacoes?: string | null
          quantidade_pausas?: number
          responsavel?: string | null
          status?: string
          tempo_trabalhado?: number | null
          tipo?: string
          total_tempo_pausado?: number
          ultima_pausa?: string | null
          ultima_retomada?: string | null
          unidade_id: string
        }
        Update: {
          almoxarife?: string | null
          assinatura?: string | null
          assinatura_gestor?: string | null
          codigo_almoxarife?: string | null
          conferente?: string | null
          created_at?: string
          created_by?: string | null
          data?: string
          hora_fim?: string | null
          hora_inicio?: string
          id?: string
          observacoes?: string | null
          quantidade_pausas?: number
          responsavel?: string | null
          status?: string
          tempo_trabalhado?: number | null
          tipo?: string
          total_tempo_pausado?: number
          ultima_pausa?: string | null
          ultima_retomada?: string | null
          unidade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conferencias_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_sistema: {
        Row: {
          chave: string
          updated_at: string
          valor: Json
        }
        Insert: {
          chave: string
          updated_at?: string
          valor?: Json
        }
        Update: {
          chave?: string
          updated_at?: string
          valor?: Json
        }
        Relationships: []
      }
      empresa_modulos: {
        Row: {
          ativo: boolean
          codigo: string
          cor: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          excluido: boolean
          icone: string
          id: string
          nome: string
          ordem: number
          origem: string
          recursos: Json
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          cor?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          excluido?: boolean
          icone?: string
          id?: string
          nome: string
          ordem?: number
          origem?: string
          recursos?: Json
          tipo?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          cor?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          excluido?: boolean
          icone?: string
          id?: string
          nome?: string
          ordem?: number
          origem?: string
          recursos?: Json
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_modulos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_setores: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          created_by: string | null
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          ordem: number
          origem: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          ordem?: number
          origem?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          ordem?: number
          origem?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_setores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_usuarios: {
        Row: {
          ativo: boolean
          created_at: string
          empresa_id: string
          id: string
          papel: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          papel?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          papel?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_whatsapp_destinatarios: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          empresa_id: string
          id: string
          nome: string
          receber_conclusao_conferencia: boolean
          receber_inicio_conferencia: boolean
          telefone: string
          telefone_normalizado: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          empresa_id: string
          id?: string
          nome: string
          receber_conclusao_conferencia?: boolean
          receber_inicio_conferencia?: boolean
          telefone: string
          telefone_normalizado: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          receber_conclusao_conferencia?: boolean
          receber_inicio_conferencia?: boolean
          telefone?: string
          telefone_normalizado?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_whatsapp_destinatarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativo: boolean
          bloqueada: boolean
          bloqueada_em: string | null
          cnpj: string | null
          config: Json
          created_at: string
          created_by: string | null
          desativada_em: string | null
          email_contato: string | null
          id: string
          motivo_bloqueio: string | null
          nome: string
          observacoes: string | null
          onboarding_etapa: string | null
          segmento: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bloqueada?: boolean
          bloqueada_em?: string | null
          cnpj?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          desativada_em?: string | null
          email_contato?: string | null
          id?: string
          motivo_bloqueio?: string | null
          nome: string
          observacoes?: string | null
          onboarding_etapa?: string | null
          segmento?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bloqueada?: boolean
          bloqueada_em?: string | null
          cnpj?: string | null
          config?: Json
          created_at?: string
          created_by?: string | null
          desativada_em?: string | null
          email_contato?: string | null
          id?: string
          motivo_bloqueio?: string | null
          nome?: string
          observacoes?: string | null
          onboarding_etapa?: string | null
          segmento?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      historico_conferencias: {
        Row: {
          conferencia_id: string | null
          created_at: string
          data: string
          detalhes: Json
          divergencias: number
          duracao_segundos: number | null
          empresa_id: string | null
          hora_fim: string | null
          hora_inicio: string
          id: string
          lista: string | null
          modulo: string
          modulo_id: string | null
          modulo_titulo: string | null
          nome: string | null
          percentual: number
          perfil: string | null
          quantidade_conferida: number
          quantidade_pausas: number
          quantidade_prevista: number
          setor: string | null
          status: string
          tempo_trabalhado: number | null
          total_tempo_pausado: number
          ultima_pausa: string | null
          ultima_retomada: string | null
          unidade_id: string | null
          updated_at: string
          user_id: string
          usuario_email: string | null
        }
        Insert: {
          conferencia_id?: string | null
          created_at?: string
          data?: string
          detalhes?: Json
          divergencias?: number
          duracao_segundos?: number | null
          empresa_id?: string | null
          hora_fim?: string | null
          hora_inicio?: string
          id?: string
          lista?: string | null
          modulo?: string
          modulo_id?: string | null
          modulo_titulo?: string | null
          nome?: string | null
          percentual?: number
          perfil?: string | null
          quantidade_conferida?: number
          quantidade_pausas?: number
          quantidade_prevista?: number
          setor?: string | null
          status?: string
          tempo_trabalhado?: number | null
          total_tempo_pausado?: number
          ultima_pausa?: string | null
          ultima_retomada?: string | null
          unidade_id?: string | null
          updated_at?: string
          user_id?: string
          usuario_email?: string | null
        }
        Update: {
          conferencia_id?: string | null
          created_at?: string
          data?: string
          detalhes?: Json
          divergencias?: number
          duracao_segundos?: number | null
          empresa_id?: string | null
          hora_fim?: string | null
          hora_inicio?: string
          id?: string
          lista?: string | null
          modulo?: string
          modulo_id?: string | null
          modulo_titulo?: string | null
          nome?: string | null
          percentual?: number
          perfil?: string | null
          quantidade_conferida?: number
          quantidade_pausas?: number
          quantidade_prevista?: number
          setor?: string | null
          status?: string
          tempo_trabalhado?: number | null
          total_tempo_pausado?: number
          ultima_pausa?: string | null
          ultima_retomada?: string | null
          unidade_id?: string | null
          updated_at?: string
          user_id?: string
          usuario_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_conferencias_conferencia_id_fkey"
            columns: ["conferencia_id"]
            isOneToOne: true
            referencedRelation: "conferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_conferencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_conferencias_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "empresa_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      integracoes: {
        Row: {
          ativo: boolean
          config: Json
          created_at: string
          id: string
          nome: string
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          config?: Json
          created_at?: string
          id?: string
          nome: string
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          config?: Json
          created_at?: string
          id?: string
          nome?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      materiais: {
        Row: {
          codigo: string
          created_at: string
          descricao: string
          funcionario_codigo: string | null
          funcionario_nome: string | null
          id: string
          imagem_principal: string | null
          locacao: string | null
          quantidade_esperada: number
          unidade_id: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descricao?: string
          funcionario_codigo?: string | null
          funcionario_nome?: string | null
          id?: string
          imagem_principal?: string | null
          locacao?: string | null
          quantidade_esperada?: number
          unidade_id: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descricao?: string
          funcionario_codigo?: string | null
          funcionario_nome?: string | null
          id?: string
          imagem_principal?: string | null
          locacao?: string | null
          quantidade_esperada?: number
          unidade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "materiais_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      material_imagens: {
        Row: {
          created_at: string
          descricao: string | null
          id: string
          material_id: string
          url_imagem: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          material_id: string
          url_imagem: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          id?: string
          material_id?: string
          url_imagem?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_imagens_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
        ]
      }
      metas: {
        Row: {
          alvo: string
          alvo_nome: string | null
          ativo: boolean
          created_at: string
          created_by: string | null
          empresa_id: string | null
          escopo: string
          id: string
          max_divergencias: number | null
          min_conferencias: number | null
          modulo_id: string | null
          percentual_min: number | null
          periodo: string
          tempo_max_segundos: number | null
          updated_at: string
        }
        Insert: {
          alvo: string
          alvo_nome?: string | null
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          escopo?: string
          id?: string
          max_divergencias?: number | null
          min_conferencias?: number | null
          modulo_id?: string | null
          percentual_min?: number | null
          periodo?: string
          tempo_max_segundos?: number | null
          updated_at?: string
        }
        Update: {
          alvo?: string
          alvo_nome?: string | null
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          escopo?: string
          id?: string
          max_divergencias?: number | null
          min_conferencias?: number | null
          modulo_id?: string | null
          percentual_min?: number | null
          periodo?: string
          tempo_max_segundos?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "empresa_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_emails: {
        Row: {
          assunto: string | null
          confirmado: boolean
          created_at: string
          destinatario: string
          enviado_em: string
          erro: string | null
          id: string
          notificacao_id: string | null
          status: string
          tentativa: number
        }
        Insert: {
          assunto?: string | null
          confirmado?: boolean
          created_at?: string
          destinatario: string
          enviado_em?: string
          erro?: string | null
          id?: string
          notificacao_id?: string | null
          status?: string
          tentativa?: number
        }
        Update: {
          assunto?: string | null
          confirmado?: boolean
          created_at?: string
          destinatario?: string
          enviado_em?: string
          erro?: string | null
          id?: string
          notificacao_id?: string | null
          status?: string
          tentativa?: number
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_emails_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "notificacoes_conferencia"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_leituras: {
        Row: {
          chave: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          chave: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Update: {
          chave?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      notificacoes_conferencia: {
        Row: {
          assunto: string | null
          conferencia_id: string | null
          created_at: string
          data: string
          email_status: string
          empresa_id: string | null
          frota: string | null
          gravidade: string
          hora: string | null
          id: string
          local: string | null
          matricula: string | null
          mensagem: string | null
          modulo: string | null
          modulo_id: string | null
          payload: Json
          status: string
          tentativas: number
          tipo: string
          tipo_conferencia: string | null
          ultima_tentativa: string | null
          unidade_id: string | null
          updated_at: string
          user_id: string
          usuario_email: string | null
          usuario_nome: string | null
        }
        Insert: {
          assunto?: string | null
          conferencia_id?: string | null
          created_at?: string
          data?: string
          email_status?: string
          empresa_id?: string | null
          frota?: string | null
          gravidade?: string
          hora?: string | null
          id?: string
          local?: string | null
          matricula?: string | null
          mensagem?: string | null
          modulo?: string | null
          modulo_id?: string | null
          payload?: Json
          status?: string
          tentativas?: number
          tipo?: string
          tipo_conferencia?: string | null
          ultima_tentativa?: string | null
          unidade_id?: string | null
          updated_at?: string
          user_id: string
          usuario_email?: string | null
          usuario_nome?: string | null
        }
        Update: {
          assunto?: string | null
          conferencia_id?: string | null
          created_at?: string
          data?: string
          email_status?: string
          empresa_id?: string | null
          frota?: string | null
          gravidade?: string
          hora?: string | null
          id?: string
          local?: string | null
          matricula?: string | null
          mensagem?: string | null
          modulo?: string | null
          modulo_id?: string | null
          payload?: Json
          status?: string
          tentativas?: number
          tipo?: string
          tipo_conferencia?: string | null
          ultima_tentativa?: string | null
          unidade_id?: string | null
          updated_at?: string
          user_id?: string
          usuario_email?: string | null
          usuario_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_conferencia_conferencia_id_fkey"
            columns: ["conferencia_id"]
            isOneToOne: false
            referencedRelation: "conferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_conferencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_conferencia_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "empresa_modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_conferencia_unidade_id_fkey"
            columns: ["unidade_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      permissoes_perfil: {
        Row: {
          acoes: string[]
          created_at: string
          id: string
          modulo: string
          perfil: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acoes?: string[]
          created_at?: string
          id?: string
          modulo: string
          perfil: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acoes?: string[]
          created_at?: string
          id?: string
          modulo?: string
          perfil?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      permissoes_usuario: {
        Row: {
          acoes: string[]
          created_at: string
          id: string
          modulo: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          acoes?: string[]
          created_at?: string
          id?: string
          modulo: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          acoes?: string[]
          created_at?: string
          id?: string
          modulo?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      planos: {
        Row: {
          ambiente: string
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string | null
          dias_trial: number
          id: string
          limites: Json
          max_usuarios: number | null
          modulos: string[]
          moeda: string
          nome: string
          ordem: number
          periodicidade: string | null
          provider_plan_atualizado_em: string | null
          provider_plan_id: string | null
          provider_price_id: string | null
          provider_product_id: string | null
          recursos: Json
          updated_at: string
          valor_centavos: number | null
        }
        Insert: {
          ambiente?: string
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string | null
          dias_trial?: number
          id?: string
          limites?: Json
          max_usuarios?: number | null
          modulos?: string[]
          moeda?: string
          nome: string
          ordem?: number
          periodicidade?: string | null
          provider_plan_atualizado_em?: string | null
          provider_plan_id?: string | null
          provider_price_id?: string | null
          provider_product_id?: string | null
          recursos?: Json
          updated_at?: string
          valor_centavos?: number | null
        }
        Update: {
          ambiente?: string
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string | null
          dias_trial?: number
          id?: string
          limites?: Json
          max_usuarios?: number | null
          modulos?: string[]
          moeda?: string
          nome?: string
          ordem?: number
          periodicidade?: string | null
          provider_plan_atualizado_em?: string | null
          provider_plan_id?: string | null
          provider_price_id?: string | null
          provider_product_id?: string | null
          recursos?: Json
          updated_at?: string
          valor_centavos?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          nome: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          nome?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          nome?: string | null
        }
        Relationships: []
      }
      relatorios_agendados: {
        Row: {
          ativo: boolean
          created_at: string
          created_by: string | null
          destinatarios: string
          filtros: Json
          fonte: string
          formato: string
          frequencia: string
          hora: string
          id: string
          nome: string
          ultima_execucao: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          destinatarios?: string
          filtros?: Json
          fonte?: string
          formato?: string
          frequencia?: string
          hora?: string
          id?: string
          nome: string
          ultima_execucao?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          created_by?: string | null
          destinatarios?: string
          filtros?: Json
          fonte?: string
          formato?: string
          frequencia?: string
          hora?: string
          id?: string
          nome?: string
          ultima_execucao?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sessoes_usuario: {
        Row: {
          created_at: string
          dispositivo: string | null
          encerrada_em: string | null
          encerrada_por: string | null
          id: string
          iniciada_em: string
          ip: string | null
          motivo_encerramento: string | null
          navegador: string | null
          ultimo_ping: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dispositivo?: string | null
          encerrada_em?: string | null
          encerrada_por?: string | null
          id?: string
          iniciada_em?: string
          ip?: string | null
          motivo_encerramento?: string | null
          navegador?: string | null
          ultimo_ping?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dispositivo?: string | null
          encerrada_em?: string | null
          encerrada_por?: string | null
          id?: string
          iniciada_em?: string
          ip?: string | null
          motivo_encerramento?: string | null
          navegador?: string | null
          ultimo_ping?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      unidades: {
        Row: {
          ano: string | null
          ativo: boolean
          created_at: string
          empresa_id: string | null
          frota: string | null
          gestor: string | null
          id: string
          matricula: string | null
          modelo: string | null
          modulo_id: string | null
          nome: string
          observacoes: string | null
          placa: string | null
          setor: string | null
          tipo: string
        }
        Insert: {
          ano?: string | null
          ativo?: boolean
          created_at?: string
          empresa_id?: string | null
          frota?: string | null
          gestor?: string | null
          id?: string
          matricula?: string | null
          modelo?: string | null
          modulo_id?: string | null
          nome: string
          observacoes?: string | null
          placa?: string | null
          setor?: string | null
          tipo?: string
        }
        Update: {
          ano?: string | null
          ativo?: boolean
          created_at?: string
          empresa_id?: string | null
          frota?: string | null
          gestor?: string | null
          id?: string
          matricula?: string | null
          modelo?: string | null
          modulo_id?: string | null
          nome?: string
          observacoes?: string | null
          placa?: string | null
          setor?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "unidades_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "empresa_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          assinatura: string | null
          bloqueado: boolean
          created_at: string
          foto_url: string | null
          id: string
          nome: string | null
          perfil: string
          setor: string | null
          ultimo_acesso: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assinatura?: string | null
          bloqueado?: boolean
          created_at?: string
          foto_url?: string | null
          id?: string
          nome?: string | null
          perfil?: string
          setor?: string | null
          ultimo_acesso?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assinatura?: string | null
          bloqueado?: boolean
          created_at?: string
          foto_url?: string | null
          id?: string
          nome?: string | null
          perfil?: string
          setor?: string | null
          ultimo_acesso?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      usuarios_legados: {
        Row: {
          created_at: string
          email: string
          id: string
          motivo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          motivo?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          motivo?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_eventos_pagamento: {
        Row: {
          ambiente: string
          erro: string | null
          event_type: string
          id: string
          payload: Json
          processado: boolean
          processado_em: string | null
          provider: string
          provider_event_id: string
          recebido_em: string
        }
        Insert: {
          ambiente?: string
          erro?: string | null
          event_type: string
          id?: string
          payload?: Json
          processado?: boolean
          processado_em?: string | null
          provider?: string
          provider_event_id: string
          recebido_em?: string
        }
        Update: {
          ambiente?: string
          erro?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processado?: boolean
          processado_em?: string | null
          provider?: string
          provider_event_id?: string
          recebido_em?: string
        }
        Relationships: []
      }
      whatsapp_notificacoes: {
        Row: {
          conferencia_id: string | null
          created_at: string
          destinatario_id: string | null
          empresa_id: string
          erro: string | null
          id: string
          idempotency_key: string
          payload: Json
          provider_message_id: string | null
          sent_at: string | null
          status: string
          telefone_mascarado: string | null
          tipo_evento: string
          updated_at: string
        }
        Insert: {
          conferencia_id?: string | null
          created_at?: string
          destinatario_id?: string | null
          empresa_id: string
          erro?: string | null
          id?: string
          idempotency_key: string
          payload?: Json
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          telefone_mascarado?: string | null
          tipo_evento: string
          updated_at?: string
        }
        Update: {
          conferencia_id?: string | null
          created_at?: string
          destinatario_id?: string | null
          empresa_id?: string
          erro?: string | null
          id?: string
          idempotency_key?: string
          payload?: Json
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          telefone_mascarado?: string | null
          tipo_evento?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_notificacoes_conferencia_id_fkey"
            columns: ["conferencia_id"]
            isOneToOne: false
            referencedRelation: "conferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_notificacoes_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "empresa_whatsapp_destinatarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_notificacoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assinatura_ativa_empresa: {
        Args: { _ambiente?: string; _empresa_id: string }
        Returns: boolean
      }
      criar_empresa_onboarding: {
        Args: {
          _cnpj?: string
          _email?: string
          _nome: string
          _observacoes?: string
          _telefone?: string
        }
        Returns: string
      }
      criar_modulos_iniciais: {
        Args: { _empresa_id: string; _modulos: Json }
        Returns: number
      }
      criar_setores_iniciais: {
        Args: { _empresa_id: string; _setores: Json }
        Returns: number
      }
      diagnostico_permissoes: { Args: { _user_id: string }; Returns: Json }
      eh_usuario_legado: { Args: { _user_id: string }; Returns: boolean }
      empresa_do_usuario: { Args: { _user_id: string }; Returns: string }
      empresas_do_usuario: { Args: { _user_id: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      modulos_ativos_empresa: { Args: { _empresa_id: string }; Returns: number }
      plano_da_empresa: {
        Args: { _ambiente?: string; _empresa_id: string }
        Returns: Json
      }
      usuarios_ativos_empresa: {
        Args: { _empresa_id: string }
        Returns: number
      }
      validar_hook: {
        Args: { _nome: string; _valor: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "conferente" | "visualizador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "conferente", "visualizador"],
    },
  },
} as const
