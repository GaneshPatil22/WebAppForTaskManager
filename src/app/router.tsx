import { createRootRoute, createRoute, createRouter, Link } from '@tanstack/react-router';
import { Shell } from './Shell';
import { TodayPage } from '../features/today/TodayPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { ItemsPage } from '../features/items/ItemsPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { WeekPage } from '../features/week/WeekPage';
import { RepeatsPage } from '../features/repeats/RepeatsPage';
import { ProgressPage } from '../features/progress/ProgressPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { isOn, viewPrefsStore, VIEWS, type ViewId } from '../domain/views';
import type { ReactElement } from 'react';

type Page = () => ReactElement;

/** A view the user switched off still has a URL; it explains itself instead of 404ing. */
function gated(id: ViewId, Page: Page): Page {
  return function Gated() {
    const prefs = viewPrefsStore.use();
    if (isOn(prefs, id)) return <Page />;
    const v = VIEWS.find((x) => x.id === id)!;
    return (
      <div className="vhead"><div className="grow">
        <h1>{v.title} is switched off</h1>
        <p>You can turn it back on in <Link to="/settings">Settings</Link>.</p>
      </div></div>
    );
  };
}

const root = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <div className="vhead"><div className="grow"><h1>Not found</h1><p><Link to="/">Back to today</Link></p></div></div>
  ),
});

const pages: [string, Page][] = [
  ['/', TodayPage],
  ['/inbox', InboxPage],
  ['/items', gated('items', ItemsPage)],
  ['/goals', gated('goals', GoalsPage)],
  ['/week', gated('week', WeekPage)],
  ['/repeats', gated('repeats', RepeatsPage)],
  ['/progress', gated('progress', ProgressPage)],
  ['/settings', SettingsPage],
];

const routeTree = root.addChildren(pages.map(([path, component]) => createRoute({ getParentRoute: () => root, path, component })));

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
