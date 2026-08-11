/**
 * Temporary kill-switch while IAM is redesigned.
 * When false: no login gate, nav is fully public, studio uses the service
 * role (if configured) so editorial tools keep working without a session.
 */
export const AUTH_ENABLED = false;
