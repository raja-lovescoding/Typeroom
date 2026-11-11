import { SettingsForm } from '../components/SettingsForm.js';
import { Link } from '../lib/router.js';
import { ProsePage } from './Page.js';

export function SettingsPage() {
  return <ProsePage
    title="Settings"
    lead={<>Make Typeroom look, sound and move the way you like. These settings only change what <em>you</em> see. They never affect the race and are saved in this browser only (see the <Link to="/privacy">Privacy Policy</Link>).</>}
  >
    <SettingsForm />
  </ProsePage>;
}
