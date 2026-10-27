
export interface WorkOsProject {
  id: string;
  name: string;
  archived?: boolean;
}

export interface WorkOsMember {
  id: string;
  name: string;
  email?: string | null;
}

export interface WorkOsTask {
  id: string;
  name: string;
  projectId?: string | null;
  taskGroupId?: string | null;
  completed?: boolean | null;
  assignees: string[];
  dueDate?: string | null;
  startDate?: string | null;
  completedAt?: string | null;
  description?: string | null;
}

export interface WorkOsProjectsResponse {
  projects: WorkOsProject[];
  error?: string;
}

export interface WorkOsMembersResponse {
  members: WorkOsMember[];
  error?: string;
}

export interface WorkOsTasksResponse {
  tasks: WorkOsTask[];
  hasMore?: boolean;
  error?: string;
}
