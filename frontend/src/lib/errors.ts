/**
 * Map Move abort errors to user-facing messages.
 *
 * Move 2024 `#[error]` consts surface the byte-string in the abort code's
 * upper bits via the verifier, but the JSON-RPC error string is more reliable:
 * we match on the substring of the const name appearing in `MoveAbort`.
 *
 * Sample raw error from RPC:
 *   "MoveAbort(MoveLocation { module: ModuleId { ... access_grant }, function: 2,
 *    instruction: 17, function_name: Some(\"consume_grant\") }, 4) in command 0"
 *
 * We can't always recover the const name, so we keep both numeric (positional
 * fallback) and name-substring tables.
 */

export interface FriendlyError {
  code: string;
  title: string;
  hint: string;
}

const NAMED: Record<string, FriendlyError> = {
  ENotOwner: { code: 'NOT_OWNER', title: 'Not your record', hint: 'Only the patient who owns this record can perform that action.' },
  ETombstoned: { code: 'TOMBSTONED', title: 'Record was revoked', hint: 'This record has been deleted by the patient.' },
  EInvalidContentHash: { code: 'BAD_HASH', title: 'Invalid content hash', hint: 'Ciphertext hash must be 32 bytes (sha3-256).' },
  EEmptyBlobId: { code: 'EMPTY_BLOB', title: 'Missing Walrus blob', hint: 'Walrus upload did not return a blob ID.' },
  EEmptyHospitalId: { code: 'EMPTY_HOSPITAL', title: 'Hospital ID required', hint: 'Pick a hospital before creating the record.' },
  ENotIssuer: { code: 'NOT_ISSUER', title: 'Not the grant issuer', hint: 'Only the patient who issued this access can revoke it.' },
  EGrantExpired: { code: 'EXPIRED', title: 'Access expired', hint: 'Ask the patient to issue a new QR code.' },
  EGrantUsed: { code: 'USED', title: 'Already used', hint: 'This QR code is single-use and has already been consumed.' },
  EGrantRevoked: { code: 'REVOKED', title: 'Access revoked', hint: 'The patient cancelled this access.' },
  EInvalidToken: { code: 'BAD_TOKEN', title: 'Invalid QR code', hint: 'The scanned QR does not match this record. Re-scan.' },
  EInvalidScope: { code: 'BAD_SCOPE', title: 'Invalid scope', hint: 'Scope must be Single, Period, or Disease.' },
  ETtlOutOfRange: { code: 'BAD_TTL', title: 'Invalid duration', hint: 'TTL must be between 1 minute and 30 days.' },
  ERecordTombstoned: { code: 'RECORD_REVOKED', title: 'Record revoked', hint: 'Cannot grant access to a revoked record.' },
  ENotRecordOwner: { code: 'NOT_RECORD_OWNER', title: 'Not your record', hint: 'You can only grant access to your own records.' },
  EInvalidTokenHashLen: { code: 'BAD_TOKEN_HASH', title: 'Invalid token hash', hint: 'Token hash must be 32 bytes.' },
  ERecordMismatch: { code: 'MISMATCH', title: 'Wrong record', hint: 'QR code is for a different record.' },
  ERecordRevoked: { code: 'CASCADED', title: 'Record revoked', hint: 'Patient revoked this record after issuing the QR. Access denied.' },
};

export function explainMoveError(rawError: unknown): FriendlyError {
  const msg = String(rawError ?? '');
  for (const [name, friendly] of Object.entries(NAMED)) {
    if (msg.includes(name)) return friendly;
  }
  if (msg.includes('MoveAbort')) {
    return { code: 'MOVE_ABORT', title: 'Transaction failed', hint: 'On-chain check failed. Open dev console for details.' };
  }
  if (msg.includes('InsufficientGas') || msg.includes('GasBalanceTooLow')) {
    return { code: 'NO_GAS', title: 'Insufficient gas', hint: 'Top up SUI in your wallet and retry.' };
  }
  return { code: 'UNKNOWN', title: 'Something went wrong', hint: msg.slice(0, 200) };
}
