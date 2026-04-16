import { defineTests } from '../src/config/helpers';

export default defineTests([
  {
    name: 'TodoMVC — Core Workflow',
    url: 'https://demo.playwright.dev/todomvc',
    roles: [],
    steps: [
      'Add a new todo item with the text "Buy groceries"',
      'Add a second todo item with the text "Walk the dog"',
      'Verify both todo items appear in the list',
      'Mark "Buy groceries" as completed by clicking its checkbox',
      'Verify "Buy groceries" is marked as completed',
      'Click the "Active" filter to show only active items',
      'Verify only "Walk the dog" is visible in the list',
      'Click the "All" filter to show all items',
      'Verify both items are shown again',
    ],
  },
]);
