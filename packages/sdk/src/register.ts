/** Side-effect entry — registers all custom elements once. */
import './components/badge';
import './components/button';
import './components/card';
import './components/divider';
import './components/icon';
import './components/input';
import './components/select';
import './components/spinner';

export {
  SoryeBadge,
  SoryeButton,
  SoryeCard,
  SoryeDivider,
  SoryeIcon,
  SoryeInput,
  SoryeSelect,
  SoryeSpinner,
} from './components/index';

export { SoryeElement, defineElement, hostStyles } from './base/sorye-element';
