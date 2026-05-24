# User Story: Add Product to Cart

**As a** logged-in user,
**I want to** add products to my cart,
**So that** I can review and purchase them.

## Target URL
https://www.saucedemo.com/inventory.html  (requires login first)

## Preconditions

- User is logged in as `standard_user` / `secret_sauce`
- User is on the inventory page

## Acceptance Criteria

- User can add a product to the cart from the inventory listing
- The cart badge counter increments to reflect the number of items added
- Navigating to the cart page shows the added product with its name and price
- User can remove the item from the cart page; cart badge disappears after removal

## Test Data

| Field         | Value                  |
|---------------|------------------------|
| Username      | standard_user          |
| Password      | secret_sauce           |
| Product       | Sauce Labs Backpack    |

## Notes

- Login is a precondition, not the feature under test — set it up at the start of each test.
- Cart badge selector: `.shopping_cart_badge`
- The cart page is at `/cart.html`
