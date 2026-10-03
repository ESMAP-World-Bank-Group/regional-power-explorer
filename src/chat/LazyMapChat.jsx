import { lazy, Suspense } from 'react';

// The chat and the tool protocol behind it (MCP SDK, zod, ajv) were a third of
// the app's code, and none of it is needed to draw a map. It now loads in its
// own chunk, and only once the page's map is ready, so it never competes with
// the basemap and the map data for the network.
const MapChat = lazy(() => import('./MapChat'));

export default function LazyMapChat(props) {
  if (!props.ready) return null;
  return <Suspense fallback={null}><MapChat {...props} /></Suspense>;
}
