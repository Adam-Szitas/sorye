'use client';

import { SiteCms } from './site-cms/site-cms';

/**
 * Site app (Hub-native): the website builder CMS. Content lives in Rodrigo; the
 * earlier one-page editor is replaced. Sites that were never set up in the CMS keep
 * their earlier public page until the owner publishes from here.
 */
export function AppSite() {
  return <SiteCms />;
}
