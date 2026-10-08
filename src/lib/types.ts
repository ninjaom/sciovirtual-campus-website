export type Role = 'student' | 'instructor' | 'admin'

export interface CourseRef {
  id: string
  code: string
  name: string
}

export interface Profile {
  id: string
  personCode: string
  firstName: string
  lastName: string
  role: Role
  username: string | null
  avatarUrl: string | null
  courses: CourseRef[]
}
