# No online consent capture

Code Club Wales collects **no age or parental-consent data online** — no date of birth, no parent-permission notice, no consent checkbox. Consent is treated as **implicit in the act of signing up**, mirroring how peer Code Club websites operate. Safeguarding is handled **offline** through the club's in-person registration, and the **Admission** gate means the Organiser personally vets every member before they can use the site.

This deliberately drops the Raspberry Pi Foundation-style UK-GDPR self-attestation flow (DOB + under-13 parent-permission notice) that an earlier v1 sketch proposed. Recorded so it isn't unwittingly reintroduced: the `crew_member` model holds no `dob` or `parent_permission_at`, and the join form asks only for credentials.
