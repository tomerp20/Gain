import { loadConfig } from './config.js';
import { GainMailbox } from './mailbox.js';

const USAGE = `
Usage: npm run gain -- <command>

Commands:
  ingest      Fetch all emails from the API and persist to local storage
  threads     Reconstruct email threads from stored emails
  actionable  List threads that need a reply
  reply       Reply to all actionable threads
  run         Full pipeline: ingest → threads → reply (default)
`.trim();

function printSummary(label: string, data: Record<string, unknown>): void {
  console.log(`\n=== ${label} ===`);
  for (const [k, v] of Object.entries(data)) {
    console.log(`  ${k}: ${v}`);
  }
}

async function main(): Promise<void> {
  const [, , command = 'run'] = process.argv;

  if (command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  const config = loadConfig();
  const mailbox = new GainMailbox(config);

  switch (command) {
    case 'ingest': {
      const result = await mailbox.ingest();
      printSummary('Ingest', { ...result });
      break;
    }

    case 'threads': {
      const result = await mailbox.buildThreads();
      printSummary('Threads', { ...result });
      break;
    }

    case 'actionable': {
      const threads = await mailbox.getActionableThreads();
      printSummary('Actionable', { actionable: threads.length });
      break;
    }

    case 'reply': {
      const summary = await mailbox.replyToActionable();
      printSummary('Reply', {
        replied: summary.replied,
        skippedAlreadyReplied: summary.skippedAlreadyReplied,
        skippedNotActionable: summary.skippedNotActionable,
        skippedSpam: summary.skippedSpam,
        errors: summary.errors.length,
      });
      break;
    }

    case 'run': {
      const ingest = await mailbox.ingest();
      const threads = await mailbox.buildThreads();
      const reply = await mailbox.replyToActionable();

      printSummary('Run Summary', {
        fetched: ingest.fetched,
        built: threads.built,
        actionable: threads.actionable,
        replied: reply.replied,
        skippedAlreadyReplied: reply.skippedAlreadyReplied,
        skippedSpam: reply.skippedSpam,
        errors: reply.errors.length,
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
