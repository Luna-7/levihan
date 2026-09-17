package authz.user

default allow := false

# CloudBase CLI/console administrators may invoke functions for deployment checks.
allow if {
  input.cloudbase.resource_type == "functions"
  input.subject.auth_type == "administrator"
}

# Registered users may invoke functions; individual functions still enforce
# authentication and authorization in their server-side handlers.
allow if {
  input.cloudbase.resource_type == "functions"
  input.subject.auth_type in {"external", "internal"}
}

# These read-only/pre-authentication endpoints must work before sign-in.
allow if {
  input.cloudbase.resource_type == "functions"
  input.request.path in {
    "/v1/functions/validateRegistrationInvite",
    "/v1/functions/verifyInviteCode",
    "/v1/functions/getGameLeaderboard",
  }
}
