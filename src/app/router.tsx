import { createRootRoute, createRoute, createRouter, Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { Shell } from './Shell';
import { TodayPage } from '../features/today/TodayPage';
import { CapturePage } from '../features/capture/CapturePage';
import { WeekPage } from '../features/calendar/WeekPage';
import { MonthPage } from '../features/calendar/MonthPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { JournalPage } from '../features/journal/JournalPage';
import { GoalsPage } from '../features/goals/GoalsPage';
import { CommitmentsPage } from '../features/commitments/CommitmentsPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { ItemsPage } from '../features/items/ItemsPage';
import { IdeasPage } from '../features/ideas/IdeasPage';
import { SettingsPage } from '../features/settings/SettingsPage';

const root = createRootRoute({
  component: Shell,
  notFoundComponent: () => (
    <div className="page-head"><div className="grow"><h1>Not found</h1><p><Link to="/">Back to today</Link></p></div></div>
  ),
});

const pages: [string, () => ReactElement][] = [
  ['/', TodayPage],
  ['/capture', CapturePage],
  ['/week', WeekPage],
  ['/month', MonthPage],
  ['/review', ReviewPage],
  ['/journal', JournalPage],
  ['/goals', GoalsPage],
  ['/commitments', CommitmentsPage],
  ['/inbox', InboxPage],
  ['/ideas', IdeasPage],
  ['/items', ItemsPage],
  ['/settings', SettingsPage],
];

const routeTree = root.addChildren(pages.map(([path, component]) => createRoute({ getParentRoute: () => root, path, component })));

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
