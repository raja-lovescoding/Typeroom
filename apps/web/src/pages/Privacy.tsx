/*
 * PRIVACY POLICY: KEEP THIS TRUE.
 *
 * This text describes what Typeroom actually does as of SITE.legalLastUpdated: no accounts, no
 * cookies, no analytics or third-party requests, race state in server memory only, nothing written
 * to the database. It MUST be re-reviewed (and SITE.legalLastUpdated bumped) whenever any of these
 * change, in particular when adding:
 *   - login / accounts (v1.1), or persisting race results to PostgreSQL
 *   - analytics, error reporting, A/B testing, or any third-party script, font or embed
 *   - cookies (including Socket.IO's optional sticky-session cookie), or new localStorage keys
 *   - new server logging that records nicknames, custom text or keystrokes
 *   - changes to room lifetime (ROOM_IDLE_MS), rate limiting, or log retention
 *
 * Operator details are [[PLACEHOLDERS]] until set via VITE_* variables (see config/site.ts).
 */
import { SITE } from '../config/site.js';
import { Link } from '../lib/router.js';
import { ContactEmail, Fill, ProsePage } from './Page.js';

export function Privacy() {
  return <ProsePage
    title="Privacy Policy"
    updated={SITE.legalLastUpdated}
    lead={<>Typeroom is built to need as little of your data as possible: no accounts, no cookies, no tracking. This page explains exactly what is processed, why, and for how long.</>}
  >
    <section>
      <h2>Who is responsible</h2>
      <p>
        This Typeroom service is run by <Fill value={SITE.operatorName} /> (&quot;we&quot;). For anything about your
        data, email <ContactEmail email={SITE.contactEmail} subject="Privacy request" />.
      </p>
    </section>

    <section>
      <h2>The short version</h2>
      <ul>
        <li>No accounts and no sign-up. You choose a nickname; that&apos;s it.</li>
        <li>No cookies. No analytics, advertising or tracking scripts. Fonts are served from our own server, so loading the site doesn&apos;t contact anyone else.</li>
        <li>Rooms and race results exist only in the server&apos;s memory and disappear when the room closes. Nothing about your races is saved to a database.</li>
        <li>Our servers keep standard access logs, which include your IP address, for <Fill value={SITE.logRetentionDays} /> days.</li>
        <li>We don&apos;t sell your data or share it for advertising.</li>
      </ul>
    </section>

    <section>
      <h2>What we process, and why</h2>

      <h3>Your nickname</h3>
      <p>
        The nickname you type is sent to the server when you create or join a room, checked against our nickname rules,
        and shown to the other racers in that room. The server keeps it in memory while your session is in use and forgets
        it within a few minutes of your session no longer being attached to any room. It is not written to a database or to our logs.
      </p>

      <h3>Room codes and session identifiers</h3>
      <p>
        Each room gets a random six-character code. When you first create or join a room, the server also gives your browser
        a random <em>player ID</em> (shown to others in the room so their screen can tell racers apart) and a secret
        <em> session token</em> (never shown to anyone, used only so you can reconnect to your place if your connection drops).
        Neither is linked to who you are.
      </p>

      <h3>Race data</h3>
      <p>
        To referee a race, your browser sends each keystroke to the server as it happens. The server does not keep a log of
        what you typed: it keeps only running totals (your position, correct and incorrect key counts) and the times of your
        keystrokes in the last second, which it uses to block impossibly fast input. If the host uses <em>custom text</em>, that
        text is sent to everyone in the room.
      </p>
      <p>
        Results (rank, words per minute, accuracy and finish time) are held in memory <strong>for the lifetime of the room</strong> so
        everyone can see them and race again. A room closes when its host leaves, after 10 minutes with nobody connected, or when
        the server restarts. Everything about the room, including its results and any custom text, is then gone.
      </p>
      <p>
        <strong>Quick race</strong> matches you with players of a similar speed. For that, the server keeps one number per
        player ID: a rolling average of your words per minute from races you finished. It is held in memory only, never
        written to a database, and forgotten after 7 days without a race or when the server restarts. While you wait for a
        quick race, the other people in the same lobby see your nickname.
      </p>

      <h3>IP address and request information (server logs)</h3>
      <p>
        Like almost every website, our web server records an access log entry for each request: your IP address, the date
        and time, the page or file requested (for an invite link, that includes the room code), the response status, the referring page and your browser&apos;s user-agent string.
        The application server may also log errors, which can include technical details of the request. We use these logs only
        to keep the service running and secure: diagnosing faults, and spotting and blocking abuse.
      </p>
      <p>
        Logs are kept for <strong><Fill value={SITE.logRetentionDays} /> days</strong> and then deleted.
        Separately, the server keeps your IP address in memory for up to one minute to limit how many rooms one address can
        create or join; it is never written anywhere.
      </p>

      <h3>Settings stored in your browser</h3>
      <p>Typeroom stores these items in your browser&apos;s <em>localStorage</em>. They stay on your device:</p>
      <ul>
        <li><code>typeroom.settings</code>: your display preferences (theme, font, caret, sound, motion and so on). Never sent to the server.</li>
        <li><code>typeroom.raceConfig</code>: the race mode you last picked (including any custom text), so it&apos;s preselected next time. Sent to the server only when you create a room or change its mode.</li>
        <li><code>typeroom.username</code>: your last nickname, so you don&apos;t have to retype it. Sent when you create or join a room.</li>
        <li><code>typeroom.sessionToken</code>: the session token described above. Sent when you create or join a room, so you can reconnect.</li>
      </ul>
      <p>
        You can remove them at any time by clearing this site&apos;s data in your browser settings. localStorage is not a cookie
        and is not sent with every request; nothing is stored for advertising or tracking.
      </p>
    </section>

    <section>
      <h2>Legal basis</h2>
      <p>
        Where data protection law (such as the GDPR) requires one: we process your nickname, session identifiers and race data
        because that&apos;s necessary to provide the race you asked to take part in, and we keep server logs and apply rate limits
        on the basis of our legitimate interest in keeping the service secure and available.
      </p>
    </section>

    <section>
      <h2>Who else sees your data</h2>
      <ul>
        <li><strong>Other racers in your room</strong> see your nickname, player ID, live progress and results.</li>
        <li><strong>Our hosting provider</strong>, <Fill value={SITE.hostingProvider} />, runs the servers and therefore processes the data above on our behalf.</li>
        <li>We will disclose information if the law requires it.</li>
      </ul>
      <p>We do not sell your data, and we do not share it with advertisers, data brokers or analytics companies.</p>
      <p>
        Links to other sites (for example GitHub) take you to services with their own privacy policies; nothing is sent to
        them until you follow the link.
      </p>
    </section>

    <section>
      <h2>Your rights</h2>
      <p>
        Because there are no accounts, almost everything we process disappears on its own within minutes. For data that
        lasts longer (server logs), you can ask us for access, correction or deletion, or object to the processing. Email{' '}
        <ContactEmail email={SITE.contactEmail} subject="Privacy request" /> and include the approximate date and time of
        your visit and your IP address, since logs contain nothing else that identifies you. We will reply within 30 days.
        You also have the right to complain to your local data protection authority.
      </p>
    </section>

    <section>
      <h2>Children</h2>
      <p>Typeroom isn&apos;t directed at children under 13, and we don&apos;t knowingly process their personal data beyond what is described above.</p>
    </section>

    <section>
      <h2>Changes to this policy</h2>
      <p>
        If what Typeroom does with data changes (for example, when optional accounts are introduced), we will update this page
        before the change goes live and change the &quot;last updated&quot; date above. See also the <Link to="/terms">Terms of Use</Link>.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>Privacy questions and requests: <ContactEmail email={SITE.contactEmail} subject="Privacy request" />.</p>
    </section>
  </ProsePage>;
}
