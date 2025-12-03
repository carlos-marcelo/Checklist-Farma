import { ChecklistDefinition, InputType } from './types';

export const DROGARIA_LOGO_URL = "https://i.imgur.com/example-placeholder.png"; // We will build a CSS logo to avoid external dependency issues

const INFO_BASICA_SECTION = {
  id: 'info_basica',
  title: 'Informações Básicas',
  items: [
    { id: 'nome_coordenador', text: 'Nome do Coordenador / Aplicador', type: InputType.TEXT, required: true },
    { id: 'filial', text: 'Filial', type: InputType.TEXT, required: true },
    { id: 'gestor', text: 'Gestor(a)', type: InputType.TEXT, required: true },
    { id: 'data_aplicacao', text: 'Data de Aplicação', type: InputType.DATE, required: true },
  ]
};

export const CHECKLISTS: ChecklistDefinition[] = [
  {
    id: 'gerencial',
    title: 'Checklist Gerencial',
    description: 'Avaliação de estrutura, equipamentos e POP de Gestão.',
    sections: [
      INFO_BASICA_SECTION,
      {
        id: 'estrutura',
        title: 'Estrutura Predial e Equipamentos',
        items: [
          { id: 'equipamentos', text: '1- Equipamentos eletrônicos (teclado, mouse, monitor, cabos, POS, ETC....)', type: InputType.TEXTAREA },
          { id: 'estrutura_predial', text: '2- Estrutura Predial (Descreva avarias)', type: InputType.TEXTAREA },
        ]
      },
      {
        id: 'pop_gestao',
        title: 'Procedimento Operacional Padrão (POP) Gestão',
        items: [
          { id: 'pop_1', text: '1- Análise de Log´s de Eventos e uso da senha do gestor.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_2', text: '2- Conhecimento das metas (Faturamento, CMV, Perfumaria, TKT, Fidelização, Metas App e Canais Digitais).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_3', text: '3- Impressão e assinatura da planilha de acompanhamento de vendas diária.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_4', text: '4- Análise do Índice de Fidelização (Meta > 80%).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_5', text: '5- Metas diárias individuais estabelecidas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_6', text: '6- Presença no balcão em horários de pico.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_7', text: '7- Metas quinzenais/mensais expostas no mural.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_8', text: '8- Ata de reunião semanal de resultados.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_9', text: '9- Marketing: Café, balões, exposições chamativas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_10', text: '10- Verificação de transações TEF e senhas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_11', text: '11- Escala de folgas e férias (até dia 25).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_12', text: '12- Controle de caixa (sem acúmulo > 24hrs).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_13', text: '13- Conferência fundo de caixa x escritório.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_14', text: '14- Notas Fiscais pendentes resolvidadas (max 5 dias).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_15', text: '15- Reenvio de conteúdos promocionais nas redes.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_16', text: '16- Revisão de setores e pré-vencidos (até dia 20). Produtos segregados em caixas de papelão c/ códigos e quantidades visíveis.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_17', text: '17- Limpeza e organização (esponja/sapólio semanal).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_18', text: '18- Controle de validade: Identificação de responsáveis por setor e verificação da precificação/validade.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_19', text: '19- Precificação e alteração de preços (max 24hrs).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_20', text: '20- Ambientação, decoração e bandeirolas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pop_21', text: '21- Entradas de mercadorias e erros de fração.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'gestor_farmaceutico',
        title: 'Gestor e Farmacêutico',
        items: [
          { id: 'gf_22', text: '22- Balanços de controlados/antibióticos (dias 10, 20, 30).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_23', text: '23- Segregação de pré-vencidos e solicitação de preço especial.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_24', text: '24- Controle SNGPC e receitas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_25', text: '25- Sala farmacêutica e injetáveis (limpeza/controle).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_26', text: '26- Planilha de temperatura da geladeira.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_27', text: '27- Supervisão da limpeza da auxiliar.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'gf_28', text: '28- Alvarás e documentos regulatórios em dia.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'postura_pdv',
        title: 'Postura do Gestor e Equipe (PDV)',
        items: [
          { id: 'pdv_1', text: '1- Uso da campainha na entrada de clientes.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_2', text: '2- Abertura de caixa cartão diária.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_3', text: '3- Abordagem nominal ao cliente.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_4', text: '4- Solicitação de CPF no atendimento.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_5', text: '5- Cadastro correto no Cashback (com token).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_6', text: '6- Oferecimento de itens "Bola da Vez".', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_7', text: '7- Postura e prontidão na porta da filial.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_8', text: '8- Suporte do gestor na negociação e vendas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_9', text: '9- Motivação da equipe (campanhas/desafios).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_10', text: '10- Acompanhamento canais digitais (WhatsApp/Televendas/App) e oferta do App Drogaria Cidade/Cadastros.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_11', text: '11- Finalização nominal e oferta de resgate Cashback.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pdv_12', text: '12- Orientação sobre canais digitais aos clientes.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'final',
        title: 'Finalização',
        items: [
          { id: 'consideracoes', text: 'Considerações Finais e Observações', type: InputType.TEXTAREA },
        ]
      }
    ]
  },
  {
    id: 'limpeza',
    title: 'Plano de Limpeza Completa',
    description: 'Cronograma otimizado e verificação de limpeza (1 dia c/ esfregação mensal).',
    sections: [
      INFO_BASICA_SECTION,
      {
        id: 'banheiro_cozinha',
        title: 'Banheiro e Cozinha',
        items: [
          { id: 'limp_banheiro', text: 'Banheiro: Lixo, sanitário, pia, espelho, chão.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'limp_cozinha', text: 'Cozinha: Lixo, pia, fogão, chão, louça.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'deposito',
        title: 'Depósito e Pallets',
        items: [
          { id: 'limp_deposito', text: 'Depósito: Organização, teias, varrer, limpar chão.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'limp_pallets', text: 'Pallets: Limpeza com água e detergente.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'sala_corredores',
        title: 'Salas e Corredores',
        items: [
          { id: 'limp_teias', text: 'Remoção de teias de aranha.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'limp_po', text: 'Pó dos móveis e objetos.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'limp_vidros', text: 'Janelas e portas de vidro.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'limp_chao_sala', text: 'Varrer e passar pano úmido.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'esfregacao',
        title: 'Esfregação Mensal do Chão',
        items: [
          { id: 'esf_aplicacao', text: 'Aplicação de desengordurante/sapólio.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'esf_acao', text: 'Tempo de ação do produto.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'esf_escova', text: 'Esfregação com escova/vassoura.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'esf_enxague', text: 'Enxágue e secagem.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      }
    ]
  },
  {
    id: 'cronograma',
    title: 'Cronograma Diário de Atividades',
    description: 'Rotina operacional das 07:30 às 18:00.',
    sections: [
      INFO_BASICA_SECTION,
      {
        id: 'manha',
        title: 'Manhã (07:30 - 12:00)',
        items: [
          { id: 'crono_0730', text: '07:30 - Logs, Fechamento Caixas, Café.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_0800', text: '08:00 - Revisão de Metas (CMV, TKT, etc).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_0815', text: '08:15 - Impressão/Análise Planilha Vendas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_0845', text: '08:45 - Análise Índice Fidelização.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_0915', text: '09:15 - Reunião Alinhamento Equipe.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_0945', text: '09:45 - Análise Resultados Individuais.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_app_manha', text: 'Acompanhamento de vendas no App e Canais Digitais (Entrada/Saída).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1015', text: '10:15 - Política de Precificação.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1030', text: '10:30 - Ações Corretivas.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1100', text: '11:00 - Monitoramento Contínuo.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1130', text: '11:30 - Preparação Turno Tarde.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'tarde',
        title: 'Tarde (14:30 - 18:00)',
        items: [
          { id: 'crono_1430', text: '14:30 - Eventos, Café, Balões.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1500', text: '15:00 - Verificar Remanejo/Transferências.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1515', text: '15:15 - Conferência Fundo de Caixa.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1545', text: '15:45 - Notas Fiscais Pendentes.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_app_tarde', text: 'Acompanhamento de vendas no App e Canais Digitais (Entrada/Saída).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1615', text: '16:15 - Reenvio Conteúdos Promocionais.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1630', text: '16:30 - Limpeza e Organização Setores.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'crono_1700', text: '17:00 - Controle de Validade.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      }
    ]
  },
  {
    id: 'prevencidos',
    title: 'Gestão de Pré-Vencidos e Baixa Rotatividade',
    description: 'Manual de Boas Práticas da Área 2 e Processos de Giro.',
    sections: [
      INFO_BASICA_SECTION,
      {
        id: 'baixa_rotatividade',
        title: 'Baixa Rotatividade',
        items: [
          { id: 'br_verificacao', text: '1. Verificação realizada (sem giro na filial).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'br_contato', text: '2. Contato com PVs para transferência realizado.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'br_prazo', text: '3. Transferência feita com >30 dias de validade.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'processo_vencimento',
        title: 'Produtos Próximos ao Vencimento',
        items: [
          { id: 'pv_segregacao', text: 'Segregação realizada até dia 20.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pv_exposicao', text: 'Produtos expostos em local visível (Foco).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pv_mips', text: 'Prioridade MIPs: Contato com clientes realizado.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pv_calculo', text: 'Cálculo mensal realizado (Meta < 0.20%).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pv_nota', text: 'Solicitação Nota de Baixa (Vencidos/Avarias).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'pv_desconto', text: 'Desconto Progressivo Aplicado (0.85% custo).', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      },
      {
        id: 'etapas_boas_praticas',
        title: 'Etapas Boas Práticas (Área 2)',
        items: [
          { id: 'etapa_notas_pendentes', text: 'Revisão de Notas Fiscais pendentes de entrada (últimos 30 dias).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'etapa_1', text: 'Etapa 1: Planilha enviada até dia 16.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'etapa_2', text: 'Etapa 2: Exposições montadas (Medicamentos/Perfumaria) com preços promocionais visíveis.', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'etapa_3', text: 'Etapa 3: Remanejo no sistema (Módulo 223).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'etapa_4', text: 'Etapa 4: Gravação de Preços (até 90 dias).', type: InputType.BOOLEAN_PASS_FAIL },
          { id: 'etapa_5', text: 'Etapa 5: Treinamento equipe para venda.', type: InputType.BOOLEAN_PASS_FAIL },
        ]
      }
    ]
  }
];