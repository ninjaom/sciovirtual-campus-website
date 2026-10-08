import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './layout/AppShell'
import { AdminLayout } from './layout/AdminLayout'
import { RequireAuth, SignedOutOnly } from './layout/Guards'
import { ADMIN_SECTIONS } from './layout/nav'
import { AdminPlaceholder, Placeholder } from './pages/shared/Placeholder'
import { SignIn } from './pages/auth/SignIn'
import { SignUp } from './pages/auth/SignUp'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { SignOut } from './pages/auth/SignOut'
import { Styleguide } from './pages/Styleguide'

// The styleguide is for checking components on the test site only.
const showStyleguide = window.location.hostname !== 'campus.sciovirtual.org'

export default function App() {
  return (
    <Routes>
      {/* Signed out */}
      <Route path="/" element={<SignedOutOnly><SignIn /></SignedOutOnly>} />
      <Route path="/sign-up" element={<SignedOutOnly><SignUp /></SignedOutOnly>} />
      <Route path="/forgot-password" element={<SignedOutOnly><ForgotPassword /></SignedOutOnly>} />
      {/* Reached from the reset email; the link signs the person in for this one step. */}
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/sign-out" element={<SignOut />} />

      {showStyleguide && <Route path="/styleguide" element={<Styleguide />} />}

      {/* Signed in */}
      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/home" element={<Placeholder title="Home" />} />
        <Route path="/courses" element={<RequireAuth roles={['student']}><Placeholder title="My Courses" /></RequireAuth>} />
        <Route path="/course/:code/*" element={<RequireAuth roles={['instructor', 'admin']}><Placeholder title="Course" /></RequireAuth>} />
        <Route path="/leaderboard" element={<Placeholder title="Leaderboard" />} />
        <Route path="/merchandise" element={<Placeholder title="Merchandise" />} />
        <Route path="/account" element={<Placeholder title="Account" />} />
        <Route path="/learn/*" element={<Placeholder title="Learn" />} />
        <Route path="/past-resources" element={<Placeholder title="Past Resources" />} />
        <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminLayout /></RequireAuth>}>
          {ADMIN_SECTIONS.map((s) =>
            s.to === '/admin' ? (
              <Route key={s.to} index element={<AdminPlaceholder title={s.label} />} />
            ) : (
              <Route key={s.to} path={s.to.replace('/admin/', '')} element={<AdminPlaceholder title={s.label} />} />
            ),
          )}
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
