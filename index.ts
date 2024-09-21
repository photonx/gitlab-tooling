import axios, { AxiosInstance } from 'axios';

const SOURCE_BRANCH = process.env.SOURCE_BRANCH || 'release';
const TARGET_BRANCH = process.env.TARGET_BRANCH || 'master';

const GITLAB_API_URL = 'https://gitlab.bannersnack.net/api/v4';
const PRIVATE_TOKEN = 'xxx';
const PROJECT_ID = '276';

// Axios instance with default headers
const api: AxiosInstance = axios.create({
  baseURL: GITLAB_API_URL,
  headers: {
    'Private-Token': PRIVATE_TOKEN,
  },
});

// Interfaces for type annotations
interface MergeRequest {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  [key: string]: any;
}

interface Commit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  [key: string]: any;
}

interface Diff {
  old_path: string;
  new_path: string;
  diff: string;
  [key: string]: any;
}

interface LineInfo {
  filePath: string;
  lineContent: string;
}

type AuthorLineMap = Record<string, LineInfo[]>;
type AuthorCommitMap = Record<string, number>;

async function getMergeRequestIID(
  projectId: string,
  sourceBranch: string,
  targetBranch: string
): Promise<string | null> {
  const existingMR = await findMergeRequest(
    projectId,
    sourceBranch,
    targetBranch
  );

  if (existingMR) {
    console.log(`Merge Request already exists: !${existingMR.iid}`);
    console.log(`URL: ${existingMR.web_url}`);
    return existingMR.iid.toString();
  } else {
    const title = `Merge ${sourceBranch} into ${targetBranch}`;
    // const newMR = await createMergeRequest(
    //   projectId,
    //   sourceBranch,
    //   targetBranch,
    //   title
    // );

    // if (newMR) {
    //   console.log(`Created new Merge Request: !${newMR.iid}`);
    //   console.log(`URL: ${newMR.web_url}`);
    //   return newMR.iid.toString();
    // } else {
    //   console.error('Failed to create a new merge request.');
    //   return null;
    // }

    return null;
  }
}

async function findMergeRequest(
  projectId: string,
  sourceBranch: string,
  targetBranch: string
): Promise<MergeRequest | null> {
  try {
    const response = await api.get<MergeRequest[]>(
      `/projects/${encodeURIComponent(projectId)}/merge_requests`,
      {
        params: {
          source_branch: sourceBranch,
          target_branch: targetBranch,
          state: 'opened',
        },
      }
    );

    const mergeRequests = response.data;
    if (mergeRequests.length > 0) {
      return mergeRequests[0]; // Assuming the first one is the relevant MR
    } else {
      return null;
    }
  } catch (error: any) {
    console.error('Error fetching merge requests:', error.message);
    return null;
  }
}

async function createMergeRequest(
  projectId: string,
  sourceBranch: string,
  targetBranch: string,
  title: string
): Promise<MergeRequest | null> {
  try {
    const response = await api.post<MergeRequest>(
      `/projects/${encodeURIComponent(projectId)}/merge_requests`,
      {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title: title,
      }
    );

    return response.data;
  } catch (error: any) {
    console.error(
      'Error creating merge request:',
      error.response?.data?.message || error.message
    );
    return null;
  }
}

async function getMergeRequestCommits(
  projectId: string,
  mergeRequestIID: string
): Promise<Commit[]> {
  try {
    const response = await api.get<Commit[]>(
      `/projects/${encodeURIComponent(
        projectId
      )}/merge_requests/${mergeRequestIID}/commits`
    );
    return response.data;
  } catch (error: any) {
    console.error('Error fetching merge request commits:', error.message);
    return [];
  }
}

async function getCommitDiffsAndAuthor(
  projectId: string,
  commitSha: string
): Promise<{ authorName: string; diffs: Diff[] } | null> {
  try {
    // Get commit details
    const commitResponse = await api.get(
      `/projects/${encodeURIComponent(
        projectId
      )}/repository/commits/${commitSha}`
    );
    const authorName: string = commitResponse.data.author_name;

    // Get commit diffs
    const diffResponse = await api.get<Diff[]>(
      `/projects/${encodeURIComponent(
        projectId
      )}/repository/commits/${commitSha}/diff`
    );
    const diffs: Diff[] = diffResponse.data;

    return { authorName, diffs };
  } catch (error: any) {
    console.error(`Error fetching commit ${commitSha} data:`, error.message);
    return null;
  }
}

function processDiffs(
  authorName: string,
  diffs: Diff[],
  authorLineMap: AuthorLineMap
): void {
  diffs.forEach((diff) => {
    const diffLines = diff.diff.split('\n');
    let inHunk = false;

    diffLines.forEach((line) => {
      if (line.startsWith('@@')) {
        inHunk = true; // Start of a diff hunk
        return;
      }
      if (!inHunk) return;

      if (line.startsWith('+') && !line.startsWith('+++')) {
        // Line added
        const content = line.substring(1); // Remove the '+' sign
        if (!authorLineMap[authorName]) {
          authorLineMap[authorName] = [];
        }
        authorLineMap[authorName].push({
          filePath: diff.new_path,
          lineContent: content,
        });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // Line removed - you can track deletions similarly if needed
      }
    });
  });
}

// Function to count lines per contributor
function countLinesPerContributor(
  authorLineMap: AuthorLineMap
): Record<string, number> {
  const lineCountMap: Record<string, number> = {};
  for (const [author, lines] of Object.entries(authorLineMap)) {
    lineCountMap[author] = lines.length;
  }
  return lineCountMap;
}

// New function to count commits per contributor
function countCommitsPerContributor(commits: Commit[]): AuthorCommitMap {
  const commitCountMap: AuthorCommitMap = {};
  commits.forEach((commit) => {
    const author = commit.author_name;
    if (!commitCountMap[author]) {
      commitCountMap[author] = 0;
    }
    commitCountMap[author] += 1;
  });
  return commitCountMap;
}

// Function to determine the contributor with the most impact
function getContributorWithMostImpact(
  lineCountMap: Record<string, number>,
  commitCountMap: AuthorCommitMap
): string {
  const impactScores: Record<string, number> = {};

  // Calculate impact score for each contributor
  for (const author of Object.keys(lineCountMap)) {
    const linesAdded = lineCountMap[author] || 0;
    const commitsMade = commitCountMap[author] || 0;

    // You can adjust the weights as needed
    const impactScore = linesAdded + commitsMade * 10; // Giving more weight to commits
    impactScores[author] = impactScore;
  }

  // Find the contributor with the highest impact score
  let maxImpact = -Infinity;
  let topContributor = '';

  for (const [author, score] of Object.entries(impactScores)) {
    if (score > maxImpact) {
      maxImpact = score;
      topContributor = author;
    }
  }

  return topContributor;
}

async function getAuthorLineMap(
  projectId: string,
  mergeRequestIID: string
): Promise<AuthorLineMap> {
  const commits = await getMergeRequestCommits(projectId, mergeRequestIID);
  const authorLineMap: AuthorLineMap = {};

  for (const commit of commits) {
    const commitData = await getCommitDiffsAndAuthor(projectId, commit.id);
    if (commitData) {
      const { authorName, diffs } = commitData;
      processDiffs(authorName, diffs, authorLineMap);
    }
  }

  return authorLineMap;
}

(async () => {
  const projectId = PROJECT_ID;
  const sourceBranch = SOURCE_BRANCH;
  const targetBranch = TARGET_BRANCH;

  // Get or create the merge request and obtain its IID
  const MERGE_REQUEST_IID = await getMergeRequestIID(
    projectId,
    sourceBranch,
    targetBranch
  );

  if (!MERGE_REQUEST_IID) {
    console.error('Cannot proceed without a merge request IID.');
    return;
  }

  // Get commits in the merge request
  const commits = await getMergeRequestCommits(projectId, MERGE_REQUEST_IID);

  // Count commits per contributor
  const commitCountMap = countCommitsPerContributor(commits);

  // Get lines added per contributor
  const authorLineMap = await getAuthorLineMap(projectId, MERGE_REQUEST_IID);

  // Count lines added per contributor
  const lineCountMap = countLinesPerContributor(authorLineMap);

  // Display the counts
  console.log('\nLines Added Per Contributor:');
  for (const [author, lineCount] of Object.entries(lineCountMap)) {
    console.log(`Author: ${author} | Lines Added: ${lineCount}`);
  }

  console.log('\nCommits Per Contributor:');
  for (const [author, commitCount] of Object.entries(commitCountMap)) {
    console.log(`Author: ${author} | Commits: ${commitCount}`);
  }

  // Determine the contributor with the most impact
  const topContributor = getContributorWithMostImpact(
    lineCountMap,
    commitCountMap
  );

  console.log(`\nContributor with the most impact: ${topContributor}`);
})();
