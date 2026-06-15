/// Shared error code namespace. Each module re-declares its own #[error] consts
/// since #[error] consts are not exportable across modules in Move 2024.
/// This module is kept for documentation purposes only.
module portable_health::errors;

// See record_anchor.move and access_grant.move for actual #[error] declarations.
