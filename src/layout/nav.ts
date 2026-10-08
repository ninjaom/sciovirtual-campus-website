import type { Profile } from '../lib/types'

export interface NavLink {
  kind: 'link'
  label: string
  to: string
  external?: boolean
}
export interface NavGroup {
  kind: 'group'
  label: string
  items: NavLink[]
}
export type NavEntry = NavLink | NavGroup

// TODO(Om): confirm the Practice site address before launch.
export const PRACTICE_URL = '#'

const otherResources: NavGroup = {
  kind: 'group',
  label: 'Other Resources',
  items: [
    { kind: 'link', label: 'Learn', to: '/learn' },
    { kind: 'link', label: 'Past Resources', to: '/past-resources' },
    { kind: 'link', label: 'Practice', to: PRACTICE_URL, external: true },
  ],
}

/** Menubar entries per role, matching the mockups. */
export function navFor(profile: Profile): NavEntry[] {
  const link = (label: string, to: string): NavLink => ({ kind: 'link', label, to })
  switch (profile.role) {
    case 'student':
      return [
        link('Home', '/home'),
        link('My Courses', '/courses'),
        link('Leaderboard', '/leaderboard'),
        link('Merchandise', '/merchandise'),
        otherResources,
      ]
    case 'instructor': {
      const first = profile.courses[0]
      const myCourse: NavEntry =
        profile.courses.length > 1
          ? {
              kind: 'group',
              label: 'My Course',
              items: profile.courses.map((c) => link(c.name, `/course/${c.code}`)),
            }
          : link('My Course', first ? `/course/${first.code}` : '/home')
      return [link('Home', '/home'), myCourse, link('Leaderboard', '/leaderboard'), link('Merchandise', '/merchandise'), otherResources]
    }
    case 'admin':
      return [
        link('Home', '/home'),
        link('Admin', '/admin'),
        {
          kind: 'group',
          label: 'Course Pages',
          items: profile.courses.map((c) => link(c.name, `/course/${c.code}`)),
        },
        link('Leaderboard', '/leaderboard'),
        link('Merchandise', '/merchandise'),
        otherResources,
      ]
  }
}

/** Admin sidebar sections (Om's wording). */
export const ADMIN_SECTIONS: NavLink[] = [
  { kind: 'link', label: 'Overview', to: '/admin' },
  { kind: 'link', label: 'Accounts', to: '/admin/accounts' },
  { kind: 'link', label: 'Courses', to: '/admin/courses' },
  { kind: 'link', label: 'Grade Items', to: '/admin/grade-items' },
  { kind: 'link', label: 'Leaderboard & Points', to: '/admin/leaderboard' },
  { kind: 'link', label: 'Camp Announcements', to: '/admin/announcements' },
  { kind: 'link', label: 'Home Page Content', to: '/admin/home-content' },
  { kind: 'link', label: 'Merchandise', to: '/admin/merchandise' },
  { kind: 'link', label: 'Learn & Past Resources', to: '/admin/resources' },
  { kind: 'link', label: 'Attendance Fixes', to: '/admin/attendance' },
  { kind: 'link', label: 'Feedback Imports [Midpoint/Final]', to: '/admin/feedback' },
  { kind: 'link', label: 'Edit Logs', to: '/admin/logs' },
  { kind: 'link', label: 'Analytics', to: '/admin/analytics' },
]
