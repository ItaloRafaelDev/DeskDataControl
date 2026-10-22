export type CpiErrorCategory =
  | 'SESSION_REQUIRED'
  | 'FRAME_AMBIGUOUS'
  | 'CONTROL_MISSING'
  | 'CONTROL_AMBIGUOUS'
  | 'CONTROL_TYPE'
  | 'CONTROL_DISABLED'
  | 'FORM_CHANGED'
  | 'IDENTITY_MISMATCH'
  | 'PDF_INVALID'
  | 'CLASSIFICATION_UNDEFINED'
  | 'CONFIRMATION_MISSING'
  | 'INTERRUPTED'
  | 'PERSISTENCE'
  | 'VALIDATION_REQUIRED'

export interface CpiDiagnostic {
  stage: 'prepare' | 'validate' | 'review' | 'select_file' | 'verify_document' | 'reconcile'
  durationMs: number
  status: 'ok' | 'blocked' | 'uncertain' | 'failed' | 'cancelled'
  category: CpiErrorCategory | null
  recovery: 'review_again' | 'login' | 'reconcile_portal' | 'validate_portal' | 'none'
}

// Never serialize error.message/cause, portal text, URLs or document/identity data.
export class CpiControlError extends Error {
  constructor(
    readonly category: CpiErrorCategory,
    message: string
  ) {
    super(message)
  }
}
