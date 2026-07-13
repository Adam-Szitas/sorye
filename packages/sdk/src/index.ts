export {
  SoryeBadge,
  SoryeButton,
  SoryeCard,
  SoryeDivider,
  SoryeIcon,
  SoryeInput,
  SoryeSpinner,
} from './components/index';

export { SoryeElement, defineElement, hostStyles } from './base/sorye-element';

/** Tag names for all SDK elements */
export const SDK_ELEMENTS = [
  'sorye-badge',
  'sorye-button',
  'sorye-card',
  'sorye-divider',
  'sorye-icon',
  'sorye-input',
  'sorye-spinner',
] as const;

export type SdkElementName = (typeof SDK_ELEMENTS)[number];
