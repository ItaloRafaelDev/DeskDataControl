import type { OperationalSnapshot } from '../shared/contracts'

export function restoreOperation(saved?: Partial<OperationalSnapshot>): OperationalSnapshot {
  return {
    control: 'active',
    research: null,
    attachment: null,
    step: 'Selecionar CPI',
    message: '',
    ...saved,
    submission:
      saved?.submission &&
      ['selecting_file', 'file_selected', 'saving', 'verifying'].includes(saved.submission)
        ? 'uncertain'
        : (saved?.submission ?? 'idle'),
    selected: null,
    queue: null,
    identity: null,
    status: 'disconnected',
    connected: false,
    busy: false,
    pdf: null,
    ...(saved?.busy
      ? {
          step: 'Operação interrompida — revisão para retomada',
          message:
            'Revise o histórico e o portal antes de continuar. Nenhuma operação foi reenviada.'
        }
      : {})
  }
}
