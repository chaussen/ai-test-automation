# User Story: User Login

**As a** registered user,
**I want to** log in with my credentials,
**So that** I can access my personal account and product inventory.

## Target URL
https://www.saucedemo.com

## Acceptance Criteria

- Valid credentials redirect the user to the inventory page (`/inventory.html`)
- The inventory page displays a list of products after successful login
- Invalid credentials display a descriptive error message
- A locked-out account displays a specific locked-out error message

## Test Data

| Scenario         | Username          | Password     | Expected Outcome                        |
|------------------|-------------------|--------------|-----------------------------------------|
| Valid login       | standard_user     | secret_sauce | Redirected to /inventory.html           |
| Invalid password  | standard_user     | wrong_pass   | Error message visible                   |
| Locked account    | locked_out_user   | secret_sauce | Error message mentioning locked account |

## Notes

- No registration needed — credentials are fixed by the test site.
- The login form is on the root URL (`/`).
