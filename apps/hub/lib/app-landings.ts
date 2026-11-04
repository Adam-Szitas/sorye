import { APP_CATALOG } from '@sorye/types';

/** Public copy: keep this aligned with each app's actual capabilities. */
export const APP_LANDINGS: Record<string, { summary: string; steps: string[] }> = {
  catalog: { summary: 'Find the right tool for your work.', steps: ['Browse the apps.', 'Read what each one does.', 'Open an app enabled in your workspace.'] },
  contact: { summary: 'Learn about Sorye and get in touch.', steps: ['See what Sorye offers.', 'Explore document and board tools.', 'Contact the team.'] },
  dashboard: { summary: 'See what is happening in your workspace.', steps: ['Check recent activity.', 'See the apps in your package.', 'Manage workspace connections and settings.'] },
  notes: { summary: 'Write down ideas and meeting notes in one place.', steps: ['Create a note.', 'Give it a title and write your text.', 'Return to your saved notes when you need them.'] },
  calendar: { summary: 'Keep meetings, dates, and deadlines on a calendar.', steps: ['Choose a day.', 'Add an event and its time.', 'Review your upcoming plans.'] },
  relay: { summary: 'Send updates from your apps to the places your team checks.', steps: ['Enable app events in Dashboard.', 'Choose which updates to send.', 'Send them to Messenger or a connected website. Email delivery is not connected yet.'] },
  storefront: { summary: 'Browse products and send an order request.', steps: ['Choose products.', 'Add them to your cart.', 'Submit a request. Online card payment is not available yet.'] },
  site: { summary: 'Make a simple public page for your workspace.', steps: ['Choose a starter page.', 'Add text, links, and contact details.', 'Publish the page and share its link.'] },
  devtools: { summary: 'Test connections between Sorye and other software.', steps: ['Choose a connection to test.', 'Try a request or an embedded app.', 'Read the results to help find problems. This tool is for developers.'] },
  protocolio: { summary: 'Build a document layout and turn it into a PDF.', steps: ['Start with a ready-made layout or a blank document.', 'Add and arrange text, tables, and other blocks.', 'Generate a PDF through Sorye’s connected PDF service. You can also bring in a table from OCR.'] },
  canvas: { summary: 'Put ideas on a shared board so your team can work on them together.', steps: ['Create a board.', 'Add sticky notes and shapes.', 'Move things around to organize your ideas.'] },
  tasks: { summary: 'See what needs doing and track work until it is finished.', steps: ['Add a task.', 'Choose columns that match how your team works.', 'Move the task as work progresses.'] },
  messenger: { summary: 'Chat with people in your workspace.', steps: ['Open a conversation or channel.', 'Write a message or share a photo.', 'Keep team discussions together.'] },
  mail: { summary: 'Read and write messages from your workspace.', steps: ['Open your workspace mailbox.', 'Write a message or save a draft.', 'Optionally connect an existing email account to read and send its mail.'] },
  files: { summary: 'Keep workspace files in one place.', steps: ['Upload a file.', 'Find or rename it in Drive.', 'Download it when you need it.'] },
  susm: { summary: 'Open the separate SUSM service inside your Sorye workspace.', steps: ['Open SUSM from Sorye.', 'Follow the service’s own sign-in and instructions.', 'Work in its embedded page. Its data is managed separately from Sorye.'] },
  espm: { summary: 'Open the separate ESPM service inside your Sorye workspace.', steps: ['Open ESPM from Sorye.', 'Follow the service’s own sign-in and instructions.', 'Use the external beta service. Its data is managed separately from Sorye.'] },
  ocr: { summary: 'Take tables and useful information out of PDF documents.', steps: ['Upload a PDF.', 'Review the extracted tables and check unclear results.', 'Download a table or send its layout to Protocolio. Optional AI analysis requires a configured service.'] },
  studio: { summary: 'Open a 3D model and look at it from different angles.', steps: ['Upload a supported 3D model.', 'Rotate it and zoom in to inspect it.', 'Use a smaller model if the file exceeds the viewer’s limits. A compatible browser is required.'] },
  reports: { summary: 'Help administrators understand workspace activity.', steps: ['Sign in as an administrator.', 'Choose a date range.', 'Review activity counts and delivery issues. Reports do not show message or file contents.'] },
};

export function landingSlugForHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  return APP_CATALOG.find(app => host === `${app.slug}.sorye.app`)?.slug;
}
