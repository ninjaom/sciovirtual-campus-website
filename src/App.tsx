import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from './layout/AppShell'
import { AdminLayout } from './layout/AdminLayout'
import { RequireAuth, SignedOutOnly } from './layout/Guards'
import { ADMIN_SECTIONS } from './layout/nav'
import { AdminPlaceholder } from './pages/shared/Placeholder'
import { SignIn } from './pages/auth/SignIn'
import { SignUp } from './pages/auth/SignUp'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { SignOut } from './pages/auth/SignOut'
import { Styleguide } from './pages/Styleguide'
import { Overview } from './pages/admin/Overview'
import { Accounts } from './pages/admin/Accounts'
import { Courses } from './pages/admin/Courses'
import { GradeItems } from './pages/admin/GradeItems'
import { HomeContent } from './pages/admin/HomeContent'
import { LeaderboardPoints } from './pages/admin/LeaderboardPoints'
import { CampAnnouncements } from './pages/admin/CampAnnouncements'
import { MerchAdmin } from './pages/admin/MerchAdmin'
import { Resources } from './pages/admin/Resources'
import { AttendanceFixes } from './pages/admin/AttendanceFixes'
import { FeedbackImports } from './pages/admin/FeedbackImports'
import { EditLogs } from './pages/admin/EditLogs'
import { Analytics } from './pages/admin/Analytics'
import { LearnArticle, LearnIndex } from './pages/shared/Learn'
import { PastResources } from './pages/shared/PastResources'
import { Leaderboard } from './pages/shared/Leaderboard'
import { useAuth } from './lib/auth'
import { CourseLayout } from './pages/instructor/CourseLayout'
import { InstructorHome } from './pages/instructor/InstructorHome'
import { Dashboard } from './pages/instructor/Dashboard'
import { Scores } from './pages/instructor/Scores'
import { Roster } from './pages/instructor/Roster'
import { Attendance } from './pages/instructor/Attendance'
import { Feedback } from './pages/instructor/Feedback'
import { Announcements } from './pages/instructor/Announcements'
import { Account } from './pages/shared/Account'
import { StaffMerchandise, StudentMerchandise } from './pages/shared/Merchandise'
import { StudentHome } from './pages/student/StudentHome'
import { MyCourses, MyCoursesIndex } from './pages/student/MyCourses'

// The styleguide is for checking components on the test site only.
const showStyleguide = window.location.hostname !== 'campus.sciovirtual.org'

const BUILT = ['/admin', '/admin/accounts', '/admin/courses', '/admin/grade-items', '/admin/home-content', '/admin/leaderboard',
  '/admin/announcements', '/admin/merchandise', '/admin/resources', '/admin/attendance', '/admin/feedback', '/admin/logs', '/admin/analytics']

/** Home: Instructor Home for instructors; students and admins share Student Home (admins get their own cards). */
function HomeRoute() {
  const { profile } = useAuth()
  return profile?.role === 'instructor' ? <InstructorHome /> : <StudentHome />
}
function MerchRoute() {
  const { profile } = useAuth()
  return profile?.role === 'student' ? <StudentMerchandise /> : <StaffMerchandise />
}

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
        <Route path="/home" element={<HomeRoute />} />
        <Route path="/courses" element={<RequireAuth roles={['student']}><MyCoursesIndex /></RequireAuth>} />
        <Route path="/courses/:code" element={<RequireAuth roles={['student']}><MyCourses /></RequireAuth>} />
        <Route path="/course/:code" element={<RequireAuth roles={['instructor', 'admin']}><CourseLayout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="scores" element={<Scores />} />
          <Route path="roster" element={<Roster />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="announcements" element={<Announcements />} />
        </Route>
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/merchandise" element={<MerchRoute />} />
        <Route path="/account" element={<Account />} />
        <Route path="/learn" element={<LearnIndex />} />
        <Route path="/learn/:slug" element={<LearnArticle />} />
        <Route path="/past-resources" element={<PastResources />} />
        <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminLayout /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="courses" element={<Courses />} />
          <Route path="grade-items" element={<GradeItems />} />
          <Route path="home-content" element={<HomeContent />} />
          <Route path="leaderboard" element={<LeaderboardPoints />} />
          <Route path="announcements" element={<CampAnnouncements />} />
          <Route path="merchandise" element={<MerchAdmin />} />
          <Route path="resources" element={<Resources />} />
          <Route path="attendance" element={<AttendanceFixes />} />
          <Route path="feedback" element={<FeedbackImports />} />
          <Route path="logs" element={<EditLogs />} />
          <Route path="analytics" element={<Analytics />} />
          {ADMIN_SECTIONS.filter((s) => !BUILT.includes(s.to)).map((s) => (
            <Route key={s.to} path={s.to.replace('/admin/', '')} element={<AdminPlaceholder title={s.label} />} />
          ))}
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
