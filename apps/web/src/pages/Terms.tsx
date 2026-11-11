import { SITE } from '../config/site.js';
import { Link } from '../lib/router.js';
import { ContactEmail, External, Fill, ProsePage } from './Page.js';

export function Terms() {
  return <ProsePage
    title="Terms of Use"
    updated={SITE.legalLastUpdated}
    lead={<>The rules for using Typeroom. They&apos;re short: be decent, race fair, and understand that this is a free service provided as-is.</>}
  >
    <section>
      <h2>1. Agreement</h2>
      <p>
        These terms apply to the Typeroom service run by <Fill value={SITE.operatorName} /> (&quot;we&quot;, &quot;us&quot;). By
        using the service you agree to them. If you don&apos;t agree, please don&apos;t use it. Our{' '}
        <Link to="/privacy">Privacy Policy</Link> explains how we handle data.
      </p>
    </section>

    <section>
      <h2>2. The service</h2>
      <p>
        Typeroom is a free, real-time typing race. You don&apos;t need an account. We may change, pause or discontinue any part of
        the service at any time, and rooms and results are temporary by design.
      </p>
    </section>

    <section>
      <h2>3. Acceptable use</h2>
      <p>When using Typeroom you agree not to:</p>
      <ul>
        <li><strong>Abuse other people:</strong> harass, threaten, impersonate or demean anyone, or post hateful, sexual, violent or illegal content, whether in your nickname, in custom race text or anywhere else.</li>
        <li><strong>Use offensive nicknames:</strong> nicknames must not be obscene, hateful or misleading (for example, pretending to be staff or another person). Our automatic filter catches some words, but passing the filter doesn&apos;t make a nickname acceptable.</li>
        <li><strong>Cheat:</strong> use bots, scripts, macros, auto-typers, modified clients or any other automated input in races on the live service, or tamper with the messages your browser sends. The built-in practice bot is the only bot allowed.</li>
        <li><strong>Attack or overload the service:</strong> flood it with connections or requests, try to get around rate limits, scrape it, or interfere with other people&apos;s races.</li>
        <li><strong>Probe security without permission:</strong> if you find a vulnerability, report it privately (see Contact) rather than exploiting it or posting it publicly.</li>
        <li>Break any law that applies to you or to us.</li>
      </ul>
      <p>
        Running your own copy of Typeroom from the <External href={SITE.repoUrl}>source code</External> and experimenting with it,
        including with bots and scripts, is fine. These rules are about the live service and its other users.
      </p>
    </section>

    <section>
      <h2>4. Enforcement</h2>
      <p>
        To keep Typeroom fair and friendly we may, without notice and at our discretion, rename or remove players, end races,
        close rooms, and block sessions, IP addresses or networks that we believe break these terms or put the service or its
        users at risk. We aren&apos;t obliged to monitor rooms, and we don&apos;t have to explain individual decisions, but you can
        contact us if you think we got something wrong.
      </p>
    </section>

    <section>
      <h2>5. Your content</h2>
      <p>
        You are responsible for the nickname and any custom text you enter. You confirm you have the right to use it, and you
        let us display it to the people in your room for as long as the room exists. We don&apos;t claim ownership of it.
      </p>
    </section>

    <section>
      <h2>6. Open source</h2>
      <p>
        The Typeroom source code is published on <External href={SITE.repoUrl}>GitHub</External>. Your use of the code itself is
        governed by the licence in that repository, not by these terms. The fonts and other third-party components keep their
        own licences, listed on the <Link to="/about">About page</Link>.
      </p>
    </section>

    <section>
      <h2>7. No warranty</h2>
      <p>
        Typeroom is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong>, without warranties of any kind, express
        or implied, including that it will be uninterrupted, error-free or secure, or that results and statistics are accurate.
        Rooms can close and races can be lost because of disconnections, restarts or bugs.
      </p>
    </section>

    <section>
      <h2>8. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, we are not liable for any indirect, incidental or consequential loss, or for any
        loss of data, arising from your use of, or inability to use, Typeroom. Nothing in these terms limits liability that
        cannot legally be limited, or your rights as a consumer under mandatory law.
      </p>
    </section>

    <section>
      <h2>9. Changes to these terms</h2>
      <p>
        We may update these terms as Typeroom evolves. We&apos;ll change the &quot;last updated&quot; date above and, for significant
        changes, try to give notice on the site. Continuing to use Typeroom after a change means you accept the updated terms.
      </p>
    </section>

    <section>
      <h2>10. Governing law</h2>
      <p>
        These terms are governed by the laws of <Fill value={SITE.jurisdiction} />, except where mandatory consumer protection law
        in your country says otherwise.
      </p>
    </section>

    <section>
      <h2>11. Contact</h2>
      <p>Questions about these terms: <ContactEmail email={SITE.contactEmail} subject="Terms of Use" />, or see the <Link to="/contact">contact page</Link>.</p>
    </section>
  </ProsePage>;
}
