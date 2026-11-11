import { SITE } from '../config/site.js';
import { Link } from '../lib/router.js';
import { TYPING_FONTS } from '../settings/settings.js';
import { External, ProsePage } from './Page.js';

const FONT_CREDITS: Record<(typeof TYPING_FONTS)[number]['id'] | 'lexend', { name: string; authors: string; url: string; use: string }> = {
  'lexend': { name: 'Lexend', authors: 'The Lexend Project Authors', url: 'https://github.com/googlefonts/lexend', use: 'interface text' },
  'roboto-mono': { name: 'Roboto Mono', authors: 'The Roboto Mono Project Authors', url: 'https://github.com/googlefonts/robotomono', use: 'typing font (default)' },
  'jetbrains-mono': { name: 'JetBrains Mono', authors: 'The JetBrains Mono Project Authors', url: 'https://github.com/JetBrains/JetBrainsMono', use: 'typing font' },
  'fira-code': { name: 'Fira Code', authors: 'The Fira Code Project Authors', url: 'https://github.com/tonsky/FiraCode', use: 'typing font' },
  'source-code-pro': { name: 'Source Code Pro', authors: 'Adobe', url: 'https://github.com/adobe-fonts/source-code-pro', use: 'typing font' },
  'ibm-plex-mono': { name: 'IBM Plex Mono', authors: 'IBM Corp.', url: 'https://github.com/IBM/plex', use: 'typing font' },
};

const LIBRARIES: { name: string; licence: string; url: string; use: string }[] = [
  { name: 'React', licence: 'MIT', url: 'https://react.dev', use: 'user interface' },
  { name: 'Socket.IO', licence: 'MIT', url: 'https://socket.io', use: 'real-time connection (client and server)' },
  { name: 'Zod', licence: 'MIT', url: 'https://zod.dev', use: 'validating every message between browser and server' },
  { name: 'Express', licence: 'MIT', url: 'https://expressjs.com', use: 'HTTP health endpoints' },
  { name: 'pino', licence: 'MIT', url: 'https://getpino.io', use: 'server logging' },
  { name: 'Drizzle ORM', licence: 'Apache-2.0', url: 'https://orm.drizzle.team', use: 'database access' },
  { name: 'node-postgres (pg)', licence: 'MIT', url: 'https://node-postgres.com', use: 'PostgreSQL driver' },
  { name: 'Vite', licence: 'MIT', url: 'https://vite.dev', use: 'build tooling' },
  { name: 'TypeScript', licence: 'Apache-2.0', url: 'https://www.typescriptlang.org', use: 'language' },
  { name: 'Vitest', licence: 'MIT', url: 'https://vitest.dev', use: 'tests' },
  { name: 'Fontsource', licence: 'fonts keep their own licence (OFL-1.1)', url: 'https://fontsource.org', use: 'packaging of the self-hosted fonts' },
];

export function About() {
  return <ProsePage
    title="About Typeroom"
    lead={<>Typeroom is a free, open-source typing race. Make a room, share the link, and race your friends on the same text in real time, or warm up against a bot.</>}
  >
    <section>
      <h2>How a race works</h2>
      <ol>
        <li><strong>Make or join a room.</strong> Every room has a six-character code, shared as a link like <code>/r/ABC234</code>. Up to five racers fit in a room. You only need a nickname, no account.</li>
        <li><strong>The host picks a mode and starts.</strong> A five-second countdown shows everyone the same text.</li>
        <li><strong>Type.</strong> A wrong key never moves you forward: you have to type the right character to continue, so accuracy and speed both count.</li>
        <li><strong>Results.</strong> When everyone finishes (or time runs out) you see the standings, your WPM over time, and a breakdown of your keystrokes. Exit with one shortcut: <kbd className="kbd">tab</kbd> then <kbd className="kbd">enter</kbd>.</li>
      </ol>

      <h3>The server is the referee</h3>
      <p>
        Your browser only ever sends single keystrokes. The server holds the text, decides whether each key was right,
        and computes everyone&apos;s position, WPM and accuracy using its own clock. A browser can&apos;t claim to be further
        along than it is, and the server caps how fast keys are accepted, so a script can&apos;t teleport to the finish.
      </p>

      <h3>Ghost carets</h3>
      <p>
        You see the other racers as coloured carets moving through your own copy of the text, with their names above them.
        Your own caret moves the instant you press a key; theirs follow the server&apos;s ten-times-a-second updates.
        If someone&apos;s connection drops, their caret fades and they have a short grace period to come back where they left off.
      </p>

      <h3>Modes</h3>
      <ul>
        <li><strong>time</strong>: 15, 30, 60 or 120 seconds; whoever types the most correct characters wins.</li>
        <li><strong>words</strong>: 10, 25, 50 or 100 random common words; the first to finish wins.</li>
        <li><strong>quote</strong>: a short, medium or long passage, from public-domain books or written for Typeroom.</li>
        <li><strong>custom</strong>: paste your own text (up to 1,000 characters).</li>
      </ul>
      <p>Time and words modes can add punctuation and capital letters.</p>
    </section>

    <section>
      <h2>Who built it</h2>
      <p>
        Typeroom is built and maintained by <External href={SITE.author.url}>{SITE.author.name}</External>.
        The code is open source on <External href={SITE.repoUrl}>GitHub</External>. Bug reports and ideas are welcome
        as <External href={SITE.issuesUrl}>issues</External>.
      </p>
    </section>

    <section>
      <h2>Tech stack</h2>
      <ul>
        <li><strong>Browser:</strong> React and TypeScript, built with Vite. No UI framework: the design system, all fourteen themes and the logo are original.</li>
        <li><strong>Real time:</strong> Socket.IO over WebSockets between your browser and a Node.js server.</li>
        <li><strong>Server:</strong> Node.js and TypeScript. Live rooms and races are held in memory; a shared Zod schema validates every message in both directions.</li>
        <li><strong>Hosting:</strong> nginx serves the site and proxies the WebSocket; everything runs in Docker containers. PostgreSQL is provisioned for future features but stores nothing today.</li>
      </ul>
    </section>

    <section>
      <h2>Credits and inspiration</h2>
      <h3>Inspiration</h3>
      <p>
        Typeroom&apos;s look and keyboard-first feel are inspired by <External href="https://monkeytype.com">Monkeytype</External>,
        the open-source typing test by Miodec and contributors. Typeroom is a separate project: it shares no code, themes,
        word lists or other assets with Monkeytype, and isn&apos;t affiliated with it.
      </p>

      <h3>Fonts</h3>
      <p>All fonts are self-hosted (your browser never contacts a font service) and licensed under the <External href="https://openfontlicense.org">SIL Open Font License 1.1</External>.</p>
      <ul>
        {Object.values(FONT_CREDITS).map((font) => <li key={font.name}>
          <External href={font.url}>{font.name}</External> by {font.authors}, OFL-1.1, used for the {font.use}.
        </li>)}
      </ul>

      <h3>Words, quotes and sounds</h3>
      <ul>
        <li><strong>Word list</strong> (time and words modes): written for Typeroom from everyday English vocabulary. Same licence as the Typeroom source.</li>
        <li><strong>Quotes:</strong> passages from public-domain works (Austen, Brontë, Carroll, Darwin, Dickens, Emerson, Lincoln, Melville, Shakespeare, Shelley, Thoreau, Wilde), each credited on screen, with curly quotes and dashes converted to plain keyboard characters. The rest are originals written for Typeroom.</li>
        <li><strong>Sounds:</strong> the optional key clicks are synthesised live by your browser&apos;s Web Audio API. There are no recorded audio files.</li>
        <li><strong>Themes, logo and icons:</strong> original to Typeroom.</li>
      </ul>

      <h3>Open-source software</h3>
      <ul>
        {LIBRARIES.map((library) => <li key={library.name}>
          <External href={library.url}>{library.name}</External> ({library.licence}): {library.use}.
        </li>)}
      </ul>
    </section>

    <section>
      <h2>More</h2>
      <p>
        Read how Typeroom handles data in the <Link to="/privacy">Privacy Policy</Link> and the rules in the <Link to="/terms">Terms of Use</Link>.
        Questions? <Link to="/contact">Get in touch</Link>.
      </p>
    </section>
  </ProsePage>;
}
