import { defineTests } from '../src/config/helpers';

export default defineTests([
  {
    name: 'Monash University — Basic Website Tests',
    url: 'https://www.monash.edu/',
    roles: [], // public user — no authentication required
    steps: [
      'Verify the page title or main heading confirms this is the Monash University website',
      'Verify the main navigation menu is visible and contains links to key sections of the site',
      'Click the "Study" link in the navigation menu',
      'Verify the page has navigated to a study-related section by checking the URL changed or a relevant heading is visible',
      'Navigate back to the Monash University homepage',
      'Verify the homepage has reloaded and the Monash University branding is visible',
    ],
  },
]);
