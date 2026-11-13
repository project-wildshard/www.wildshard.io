// LAND-SIMPLIFY (J240, J249, J250, J258): land a plan worktree on main by fast-forward, then get out of the way.
//   1. From .worktrees/<slug> on plan/<slug> (scripts/worktree.mjs new): one land per worktree (its lock).
//   2. Rebase first if main is already ahead, then push plan/<slug> under a lease its own reflog vouches for; the
//      split pre-push runs (DS9).
//   3. Wait for that exact SHA's `ci` to go green.
//   4. Rebase onto origin/main if it moved during CI. Any conflict stops (no stamps are tracked since LS1, J250). A rebase
//      that changes the lockfile or a package.json runs `pnpm install --frozen-lockfile` before any push.
//      A clean rebase carries the branch's green run (J249: "they don't have to re-CI on rebase").
//   5. Push the SHA to main, never forced. The pre-push knows it is land's (WS_LAND_MAIN_PUSH): exact runs nothing
//      more, carried runs lint, TypeScript and the static checks, no Vitest (LS3). A lost race rebases and retries,
//      at most 5 tries (J258).
//   6. Fast-forward the canonical checkout when it is on main and clean (J247, WL7).
//   7. A `landed` receipt; main-watch follows main's own `ci` and reports it (LS5).
//   8. Delete origin's plan branch and remove this worktree (--keep skips it).
// Main's CI runs after every landing; if it goes red, the lane that landed last fixes it forward or reverts it.
//
// WORKTREE-LAND-STANDARD WL3: this is repo-kit's copy (files/scripts/land.mjs). What differs between repos lives in
// the repo's own `land.config.json` at its root, every key optional (no file: all defaults):
//   workflows  the hosted workflows, by name, whose exact-SHA push runs must be green (default ["ci"]);
//   gh         the GitHub CLI land asks Actions through (default "gh"; a path with a slash is from the repo root);
//   install    the command run when a rebase moves pnpm-lock.yaml or a package.json (default pnpm's frozen install;
//              null: no install);
//   flaky      TEST-SPEED TS10's flaky re-run and quarantine (default null: off; a red run stays red). An object
//              {quarantine, artifacts, packedStep, owner}: the J200 quarantine file, the artifact pattern holding
//              the shard reports, the packed step a flaky failure must be limited to, and the quarantine's owner.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalRoot,followMain,withStoreUse} from './worktree.mjs';
import {stopWorktreeProcesses} from './worktree-reap.mjs';

/** The settings a repo without `land.config.json` gets: J195/J240's one `ci` workflow, pnpm's frozen install, no TS10. */
export const LAND_DEFAULTS=Object.freeze({
 workflows:Object.freeze(['ci']),
 gh:'gh',
 install:Object.freeze(['pnpm','install','--frozen-lockfile','--config.confirmModulesPurge=false']),
 flaky:null,
});
/** The hosted workflows a landing needs green by default, by workflow name (J195, J240). */
export const LAND_WORKFLOWS=LAND_DEFAULTS.workflows;
const FLAKY_KEYS=['quarantine','artifacts','packedStep','owner'];
const PLAN_BRANCH=/^plan\/[a-z0-9][a-z0-9._-]*$/u;
const SHA=/^[a-f0-9]{40}$/u;

class StopError extends Error{name='StopError';}

/** @typedef {{quarantine:string,artifacts:string,packedStep:string,owner:string}} FlakyConfig */
/** @typedef {{workflows:readonly string[],gh:string,install:readonly string[]|null,flaky:FlakyConfig|null}} LandConfig */

/** Read `<root>/land.config.json` over LAND_DEFAULTS; a missing file is all defaults, anything malformed stops land.
 * @param {string} root the worktree's top level @returns {LandConfig} */
export function loadLandConfig(root){
 const file=join(root,'land.config.json');
 if(!existsSync(file))return {...LAND_DEFAULTS};
 const bad=(/** @type {string} */why)=>new StopError(`land.config.json: ${why} (keys: about, workflows, gh, install, flaky; scripts/land.mjs says what each means)`);
 /** @type {unknown} */let raw;
 try{raw=JSON.parse(readFileSync(file,'utf8'));}catch(error){throw bad(`not JSON (${error instanceof Error?error.message:String(error)})`);}
 if(raw===null||typeof raw!=='object'||Array.isArray(raw))throw bad('not an object');
 const given=/** @type {Record<string,unknown>} */(raw);
 const unknown=Object.keys(given).filter(key=>!['about','workflows','gh','install','flaky'].includes(key));
 if(unknown.length>0)throw bad(`unknown key ${unknown.join(', ')}`);
 const words=(/** @type {unknown} */value)=>Array.isArray(value)&&value.length>0&&value.every(item=>typeof item==='string'&&item!=='');
 /** @type {LandConfig} */const config={...LAND_DEFAULTS};
 if('workflows'in given){if(!words(given.workflows))throw bad('workflows must be a non-empty list of workflow names');config.workflows=Object.freeze([.../** @type {string[]} */(given.workflows)]);}
 if('gh'in given){
  if(typeof given.gh!=='string'||given.gh==='')throw bad('gh must be a command name or path');
  config.gh=given.gh.includes('/')?resolve(root,given.gh):given.gh;
 }
 if('install'in given){
  if(given.install!==null&&!words(given.install))throw bad('install must be a command as a list of words, or null');
  config.install=given.install===null?null:Object.freeze([.../** @type {string[]} */(given.install)]);
 }
 if('flaky'in given&&given.flaky!==null){
  const flaky=given.flaky;
  if(typeof flaky!=='object'||Array.isArray(flaky))throw bad('flaky must be null or an object');
  const entries=/** @type {Record<string,unknown>} */(flaky);
  const wrong=Object.keys(entries).filter(key=>!FLAKY_KEYS.includes(key));
  if(wrong.length>0)throw bad(`unknown flaky key ${wrong.join(', ')}`);
  const missing=FLAKY_KEYS.filter(key=>typeof entries[key]!=='string'||entries[key]==='');
  if(missing.length>0)throw bad(`flaky needs ${missing.join(', ')} as non-empty strings`);
  config.flaky=/** @type {FlakyConfig} */(Object.freeze({...entries}));
 }
 return config;
}

/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const git=(cwd,args,env=process.env)=>execFileSync('git',args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}).trim();
/** @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const tryGit=(cwd,args,env=process.env)=>spawnSync('git',args,{cwd,env,encoding:'utf8',maxBuffer:64<<20});
/** A ref lock another git process holds or just moved: worktrees share refs, so two lands fetching main at once race
 * for refs/remotes/origin/main ("cannot lock ref ...: is at X but expected Y", engine run 43332891983), and any git
 * may hold packed-refs.lock for a moment. Only these are retried; every other git failure stops as before. */
export const REF_LOCK=/cannot lock ref|Unable to create '[^']*\.lock': File exists/u;
const LOCK_WAITS_MS=[200,400,800,1600];
/** tryGit, tried again after a short backoff while git's only complaint is a ref lock (REF_LOCK). Only for git
 * commands safe to repeat: a fetch or a ref update, never a push.
 * @param {string} cwd @param {string[]} args @param {NodeJS.ProcessEnv} env @param {(why:string)=>void} [onRetry] */
export function tryGitLocked(cwd,args,env,onRetry){
 for(let attempt=0;;attempt++){
  const result=tryGit(cwd,args,env),wait=LOCK_WAITS_MS[attempt];
  if(result.status===0||wait===undefined||!REF_LOCK.test(String(result.stderr)))return result;
  onRetry?.(`git ${args[0]??''} lost a ref lock (${String(result.stderr).trim().split('\n')[0]??''}); retrying in ${String(wait)} ms`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,wait+Math.floor(Math.random()*wait/2));
 }
}
/** @param {string} cwd @param {string} ancestor @param {string} descendant */
const isAncestor=(cwd,ancestor,descendant)=>tryGit(cwd,['merge-base','--is-ancestor',ancestor,descendant]).status===0;
/** @param {string} cwd @param {string} from @param {string} to */
const short=(/** @type {string} */ sha)=>sha.slice(0,10);

/** `owner/name` of a GitHub remote URL, or null.
 * @param {string} remote */
export function githubSlug(remote){
 const match=/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([-\w.]+\/[-\w.]+?)(?:\.git)?\/?$/u.exec(remote.trim());
 return match?.[1]??null;
}

/** Refuse anything but the known options. Any spelling of force is refused by name.
 * @param {string[]} argv */
export function parseArgs(argv){
 const options={pollSeconds:30,timeoutMinutes:60,appearMinutes:5,rounds:5,keep:false};
 for(const arg of argv){
  if(/^-f$|force/iu.test(arg))throw new StopError(`refused ${arg}: land never force-pushes main (J240: fast-forward only). If main moved, land rebases and retries by itself`);
  const [name,value]=arg.split('=',2);
  const number=Number(value);
  // --no-watch-main is accepted for old callers: land never watches main now (LS8).
  if(name==='--no-watch-main'&&value===undefined)continue;
  if(name==='--keep'&&value===undefined)options.keep=true;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--poll')options.pollSeconds=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--timeout')options.timeoutMinutes=number;
  else if(value!==undefined&&Number.isFinite(number)&&number>0&&name==='--appear')options.appearMinutes=number;
  else if(value!==undefined&&Number.isSafeInteger(number)&&number>0&&name==='--rounds')options.rounds=number;
  else throw new StopError(`unknown option ${arg}; usage: node scripts/land.mjs [--poll=SECONDS] [--timeout=MINUTES] [--appear=MINUTES] [--rounds=N] [--keep]`);
 }
 return options;
}

/** Exact-SHA verdict from the Actions `runs?head_sha=` response: the newest
 * push run of each landing workflow, decided only when all are complete.
 * @param {unknown} data @param {string} sha @param {readonly string[]} [workflows] */
export function shaVerdict(data,sha,workflows=LAND_WORKFLOWS){
 const runs=data!==null&&typeof data==='object'&&'workflow_runs'in data&&Array.isArray(data.workflow_runs)?data.workflow_runs:[];
 /** @type {Record<string,{id:number,status:string,conclusion:string|null,branch:string,url:string,attempt:number}>} */const latest={};
 for(const run of runs){
  if(run===null||typeof run!=='object'||run.head_sha!==sha||run.event!=='push'||typeof run.id!=='number'||!workflows.includes(run.name))continue;
  const current=latest[run.name];
  if(current===undefined||run.id>current.id)latest[run.name]={id:run.id,status:String(run.status),conclusion:run.conclusion===null||run.conclusion===undefined?null:String(run.conclusion),branch:String(run.head_branch??''),url:String(run.html_url??''),attempt:Number.isSafeInteger(run.run_attempt)?Number(run.run_attempt):1};
 }
 const rows=workflows.map(name=>({name,run:latest[name]}));
 const state=rows.some(row=>row.run===undefined||row.run.status!=='completed')?'pending':rows.every(row=>row.run?.conclusion==='success')?'green':'red';
 return {state,runs:latest,summary:rows.map(row=>`${row.name} ${row.run===undefined?'none':row.run.status==='completed'?row.run.conclusion:row.run.status}`).join(', ')};
}

/** @param {string} gh the GitHub CLI (land.config.json) @param {string} repo @param {string} path */
function ghApi(gh,repo,path){
 const result=spawnSync(gh,['api',`repos/${repo}/${path}`],{encoding:'utf8',timeout:30_000,maxBuffer:64<<20});
 if(result.error!==undefined||result.status!==0)throw new Error(`gh api ${path} failed: ${`${result.stderr}${result.error?.message??''}`.trim().slice(0,300)}`);
 return /** @type {unknown} */(JSON.parse(result.stdout));
}

/** J193/J200: `quarantine (n)` jobs run quarantined files with their ordinary exit code and are continue-on-error;
 * they are red by design until rewritten and never block a landing. */
const NONBLOCKING_JOB=/^quarantine(?: \(\d+\))?$/u;
const FAILED=new Set(['failure','timed_out','cancelled','startup_failure']);

/** A run's failed jobs, split into the blocking ones and the non-blocking quarantine ones.
 * @param {unknown} data the Actions `runs/<id>/jobs` response
 * @returns {{blocking:string[],nonblocking:string[]}} */
export function failedJobs(data){
 const jobs=data!==null&&typeof data==='object'&&'jobs'in data&&Array.isArray(data.jobs)?data.jobs:[];
 /** @type {{blocking:string[],nonblocking:string[]}} */const split={blocking:[],nonblocking:[]};
 for(const job of jobs){
  if(job===null||typeof job!=='object'||!FAILED.has(String(job.conclusion)))continue;
  const name=String(job.name);
  (NONBLOCKING_JOB.test(name)?split.nonblocking:split.blocking).push(`${name} (${String(job.conclusion)})`);
 }
 return split;
}

/** @param {string} gh @param {string} repo @param {number} id @returns {{blocking:string[],nonblocking:string[]}} */
function runFailures(gh,repo,id){
 try{return failedJobs(ghApi(gh,repo,`actions/runs/${id}/jobs?filter=latest&per_page=100`));}
 catch{return {blocking:['(job list unavailable)'],nonblocking:[]};}
}

const sleep=(/** @type {number} */ ms)=>new Promise(_resolve=>{setTimeout(_resolve,ms);});

/** True when every failed blocking job of the run failed only in its packed-share step (TS10).
 * @param {string} gh @param {string} repo @param {number} id @param {string} packedStep the step's name */
function onlyPackedStepsFailed(gh,repo,id,packedStep){
 try{
  const data=ghApi(gh,repo,`actions/runs/${id}/jobs?filter=latest&per_page=100`);
  const jobs=data!==null&&typeof data==='object'&&'jobs'in data&&Array.isArray(data.jobs)?data.jobs:[];
  const failed=jobs.filter(job=>job!==null&&typeof job==='object'&&FAILED.has(String(job.conclusion))&&!NONBLOCKING_JOB.test(String(job.name)));
  return failed.length>0&&failed.every(job=>Array.isArray(job.steps)&&job.steps.filter(step=>step!==null&&typeof step==='object'&&FAILED.has(String(step.conclusion)))
   .every(step=>step.name===packedStep)&&job.steps.some(step=>step!==null&&typeof step==='object'&&FAILED.has(String(step.conclusion))));
 }catch{return false;}
}

// TEST-SPEED TS10 (J255): a hosted red whose only failures are test files gets one re-run of its failed jobs. If the
// re-run is green, each of those files takes a strike in the machine's strike book; a file with strikes from two
// different plans within 24 h is quarantined under J200 (two days, owned by the standing TEST-SPEED lane) by a
// commit land adds to the plan before its main push. A red re-run stops land as before: it blocks only its plan.
const STRIKE_WINDOW_MS=24*60*60*1000,QUARANTINE_MS=48*60*60*1000;
/** The test files to strike when a packed ci run's every blocking failure is a test file, from its downloaded
 * artifacts (land.config.json flaky.artifacts; engine's `engine-ci-*`) and the names of its failed jobs; null when any failure is something else (a static check,
 * a unit, a shard over its wall, a job with no report) or nothing names a file.
 * @param {string} directory @param {readonly string[]} jobNames blocking failed job names, e.g. `tests (2)`
 * @returns {string[]|null} */
export function flakyFiles(directory,jobNames){
 /** @type {Map<string,unknown>} */const reports=new Map();
 /** @param {string} at */
 const walk=at=>{
  /** @type {import('node:fs').Dirent[]} */let rows=[];
  try{rows=readdirSync(at,{withFileTypes:true});}catch{return;}
  for(const row of rows){
   const path=join(at,row.name);
   if(row.isDirectory())walk(path);
   else if(/^(?:shard-\d+-(?:native|ordinary|wall)|job-\d+)\.json$/u.test(row.name)){
    try{reports.set(row.name,JSON.parse(readFileSync(path,'utf8')));}catch{reports.set(row.name,null);}
   }
  }
 };
 walk(directory);
 /** @type {Set<string>} */const files=new Set();
 for(const name of jobNames){
  const job=/^tests \((\d+)\)(?: \([a-z_]+\))?$/u.exec(name)?.[1];
  if(job===undefined)return null;
  const report=reports.get(`job-${job}.json`);
  if(report===null||typeof report!=='object'||!('units'in report)||!Array.isArray(report.units)||('pinsCode'in report&&report.pinsCode!==0))return null;
  const red=report.units.filter(unit=>unit!==null&&typeof unit==='object'&&unit.blocking===true&&unit.code!==0);
  if(red.length===0)return null;
  for(const unit of red){
   const shard=/^shard:(\d+)$/u.exec(String(unit.name))?.[1];
   if(shard===undefined)return null;
   const wall=reports.get(`shard-${shard}-wall.json`);
   if(wall!==undefined&&(wall===null||typeof wall!=='object'||('overBudget'in wall&&wall.overBudget!==false)))return null;
   let named=0;
   for(const phase of ['native','ordinary']){
    const shardReport=reports.get(`shard-${shard}-${phase}.json`);
    if(shardReport===undefined)continue;
    if(shardReport===null||typeof shardReport!=='object'||!('files'in shardReport)||!Array.isArray(shardReport.files))return null;
    // An unhandled error outside any test file is not a flaky file.
    if('errorCount'in shardReport&&shardReport.errorCount!==0)return null;
    for(const file of shardReport.files){
     if(file===null||typeof file!=='object'||typeof file.file!=='string')return null;
     if(file.state==='failed'||(typeof file.durationMs==='number'&&file.durationMs>60_000)){files.add(file.file);named++;}
    }
   }
   if(named===0)return null;
  }
 }
 return files.size===0?null:[...files].sort();
}
/** The plans with a strike on `file` in the 24 h before `now`, from strike-book rows (one JSON object per line).
 * @param {string} book @param {string} file @param {number} now @returns {string[]} */
export function strikePlans(book,file,now){
 /** @type {Set<string>} */const plans=new Set();
 for(const line of book.split('\n')){
  if(line.trim()==='')continue;
  try{
   const row=/** @type {unknown} */(JSON.parse(line));
   if(row===null||typeof row!=='object'||!('file'in row)||row.file!==file||!('plan'in row)||typeof row.plan!=='string'||!('at'in row)||typeof row.at!=='string')continue;
   const at=Date.parse(row.at);
   if(Number.isFinite(at)&&at<=now&&now-at<STRIKE_WINDOW_MS)plans.add(row.plan);
  }catch{/* A torn line is skipped. */}
 }
 return [...plans].sort();
}
/** Add a J200 quarantine entry for `file` unless one is already there; false when it was.
 * @param {string} path the quarantine file (land.config.json flaky.quarantine) @param {string} file @param {string} owner @param {string} reason @param {number} now */
export function quarantineFile(path,file,owner,reason,now){
 const data=/** @type {{entries:{file:string}[]}} */(JSON.parse(readFileSync(path,'utf8')));
 if(!Array.isArray(data.entries))throw new Error(`${path} has no entries list`);
 if(data.entries.some(entry=>entry.file===file))return false;
 // J193 history: addedAt is the introducing commit's own (whole-second) time, and the deadline 48 h after it.
 const at=Math.floor(now/1000)*1000;
 data.entries.push({file,owner,addedAt:new Date(at).toISOString(),deadline:new Date(at+QUARANTINE_MS).toISOString(),reason});
 writeFileSync(path,`${JSON.stringify(data,null,2)}\n`);
 return true;
}

/** One landing, start to finish, for the worktree at `cwd`. */
class Landing{
 /** @param {string} cwd @param {ReturnType<typeof parseArgs>} options @param {NodeJS.ProcessEnv} env */
 constructor(cwd,options,env){
  this.options=options;this.env=env;this.started=Date.now();
  /** @type {{file:string,plans:string[],run:number}[]} */this.pendingQuarantine=[];
  /** @type {string[]} */this.quarantined=[];
  this.quarantineAt=0;
  /** @type {unknown[]} */this.quarantinedEntries=[];
  /** @type {LandConfig} */this.config=LAND_DEFAULTS;
  this.lane=/^[a-z][a-z0-9_-]*$/u.test(env.WS_LANE_NAME??'')?String(env.WS_LANE_NAME):'land';
  const inside=tryGit(cwd,['rev-parse','--show-toplevel']);
  if(inside.status!==0)throw new StopError('not inside a git checkout');
  this.root=inside.stdout.trim();
  this.branch=git(this.root,['branch','--show-current']);
  if(!PLAN_BRANCH.test(this.branch))throw new StopError(`land runs on a plan/<slug> branch (J240); this checkout is on ${this.branch===''?'a detached HEAD':this.branch}`);
  const gitDir=resolve(this.root,git(this.root,['rev-parse','--git-dir'])),common=resolve(this.root,git(this.root,['rev-parse','--git-common-dir']));
  if(gitDir===common)throw new StopError('land runs in a linked plan worktree (<repo>/.worktrees/<plan>), never in the canonical checkout');
  this.config=loadLandConfig(this.root);
  this.remote=git(this.root,['remote','get-url','origin']);
  const repo=env.WS_LAND_REPO??githubSlug(this.remote);
  if(repo===null||!/^[-\w.]+\/[-\w.]+$/u.test(repo))throw new StopError(`origin ${this.remote} is not a GitHub repo; land polls GitHub Actions`);
  this.repo=repo;
  /** @type {number[]} */this.runs=[];
  /** @type {string|null} */this.planTip=null;
  this.expected='';
  /** @type {string|null} */this.landedSha=null;
 }

 /** @type {(why:string)=>void} */
 retry=why=>{this.say('retry',why);};

 /** @param {string} state @param {string} detail */
 say(state,detail){process.stdout.write(`land ${new Date().toISOString().slice(11,19)} ${state.padEnd(9)} ${detail}\n`);}

 /** @param {string} message */
 receipt(message){
  const file=resolve(this.env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} UTC ${this.lane} land ${this.branch} ${message.replaceAll(/\s+/gu,' ').slice(0,1000)}\n`);}
  catch(error){process.stderr.write(`land receipt unavailable: ${String(error)}\n`);}
 }

 /** One land per worktree at a time; worktrees never wait on each other.
  * The lock file appears whole (a hard link of a written file), and a stale
  * one is taken over by rename, so two contenders can't both clear it. */
 lock(){
  const file=resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-land.lock'])),mine=`${file}.${process.pid}`;
  writeFileSync(mine,String(process.pid));
  try{
   for(let attempt=0;attempt<3;attempt++){
    try{linkSync(mine,file);return ()=>{rmSync(file,{force:true});};}
    catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='EEXIST'))throw error;}
    const owner=Number(readFileSync(file,'utf8'));
    let alive=Number.isSafeInteger(owner)&&owner>0;
    if(alive){try{process.kill(owner,0);}catch{alive=false;}}
    if(alive)throw new StopError(`land already running in this worktree (pid ${owner})`);
    // Claim the stale file by renaming it; only the contender whose rename
    // took the dead owner's file may drop it. Anything else goes back.
    const taken=`${file}.stale.${process.pid}`;
    try{renameSync(file,taken);}catch{continue;}
    if(Number(readFileSync(taken,'utf8'))===owner)rmSync(taken,{force:true});
    else{try{linkSync(taken,file);}catch{/* A live owner already holds it again. */}rmSync(taken,{force:true});}
   }
   throw new StopError('cannot take this worktree\'s land lock');
  }finally{rmSync(mine,{force:true});}
 }

 /** Stop if HEAD is not the SHA this landing is working on: a commit made
  * while land waits must never ride along unchecked.
  * @param {string} where */
 holds(where){
  const head=this.head();
  if(head!==this.expected){
   this.receipt(`STOP HEAD moved ${where}: ${short(this.expected)} -> ${short(head)}`);
   throw new StopError(`HEAD moved ${where} (${short(this.expected)} -> ${short(head)}): a commit or checkout during the landing. Run land again to land the new HEAD.`);
  }
  return head;
 }

 head(){return git(this.root,['rev-parse','HEAD']);}

 fetchMain(){
  const fetched=tryGitLocked(this.root,['fetch','--quiet','origin','+refs/heads/main:refs/remotes/origin/main'],process.env,this.retry);
  if(fetched.status!==0)throw new StopError(`git fetch origin main failed: ${fetched.stderr.trim()}`);
  return git(this.root,['rev-parse','refs/remotes/origin/main']);
 }

 clean(){
  for(const name of ['rebase-merge','rebase-apply','MERGE_HEAD','CHERRY_PICK_HEAD']){
   if(existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path',name]))))throw new StopError(`a ${name} is in progress in this worktree; finish or abort it first`);
  }
  const dirty=git(this.root,['status','--porcelain','--untracked-files=no']);
  if(dirty!=='')throw new StopError(`commit or drop tracked changes first:\n${dirty}`);
 }

 /** Rebase onto origin/main; a conflict aborts and stops with the paths.
  * @param {string} main */
 rebase(main){
  const before=this.head();
  const result=tryGit(this.root,['-c','rebase.autoStash=false','-c','rebase.updateRefs=false','rebase','--quiet',main]);
  if(result.status===0){
   this.expected=this.head();
   this.say('rebased',`${short(before)} -> ${short(this.expected)} onto main ${short(main)}`);
   this.installIfDependenciesMoved(before);
   return;
  }
  const conflicts=git(this.root,['diff','--name-only','--diff-filter=U']).split('\n').filter(Boolean);
  const aborted=tryGit(this.root,['rebase','--abort']);
  const paths=conflicts.length>0?conflicts.join(', '):'(none reported)';
  if(aborted.status!==0||this.head()!==before||existsSync(resolve(this.root,git(this.root,['rev-parse','--git-path','rebase-merge'])))){
   this.receipt(`STOP rebase onto ${short(main)} failed and its abort did not restore ${short(before)}`);
   throw new StopError(`rebase onto main ${short(main)} failed (${paths}) and git rebase --abort did not restore ${short(before)}: ${aborted.stderr.trim()}\nInspect the worktree by hand: git status, git rebase --abort.`);
  }
  this.receipt(`STOP rebase conflict onto main ${short(main)}: ${paths}`);
  throw new StopError(`rebase onto main ${short(main)} conflicts in: ${paths}\nResolve: git rebase origin/main, fix those paths, git rebase --continue, then run land again. HEAD is back at ${short(before)}.`);
 }

 /** A rebase that brought in a lockfile or package.json change: install before any pre-push, or every check fails on a
  * missing module (WR2's `@wildshard/wire` turned older worktrees red, 2026-11-11). Frozen, so the lockfile is the law.
  * @param {string} before */
 installIfDependenciesMoved(before){
  if(this.config.install===null)return;
  const moved=git(this.root,['diff','--name-only',before,'HEAD','--','pnpm-lock.yaml','package.json','**/package.json']).split('\n').filter(Boolean);
  if(moved.length===0)return;
  // Owed until it succeeds: a stop here leaves HEAD rebased, so the next land must not skip it.
  writeFileSync(this.installMarker(),`${moved.join('\n')}\n`);
  this.install(moved);
 }

 /** Where an owed install is remembered, inside this worktree's own git dir. */
 installMarker(){return resolve(this.root,git(this.root,['rev-parse','--git-path','wildshard-land-install']));}

 /** GVS G9/G10: confirmModulesPurge=false lets a worktree made before a store-layout flip reinstall without a TTY
  * (pnpm otherwise aborts: ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY). Purging is only safe in this worktree's own
  * node_modules, never through a link to the canonical checkout's, so a linked one stops. withStoreUse keeps the
  * install out of a running store prune (meta make prune), as worktree.mjs's install does.
  * @param {string[]} moved */
 install(moved){
  const [command='pnpm',...args]=this.config.install??LAND_DEFAULTS.install,shown=[command,...args].join(' ');
  const modules=join(this.root,'node_modules');
  let linked=false;
  try{linked=lstatSync(modules).isSymbolicLink();}catch{/* no node_modules yet */}
  if(linked){
   this.receipt('STOP node_modules here is a link; land will not purge through it');
   throw new StopError(`${modules} is a symlink; land installs only into this worktree's own node_modules. Replace it with a real install (rm the link, ${shown}), then run land again.`);
  }
  this.say('install',`${moved.join(', ')} changed in the rebase; ${shown}`);
  let installed;
  try{
   installed=withStoreUse(this.env,'land install',()=>spawnSync(command,args,{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20}));
  }catch(error){
   const why=error instanceof Error?error.message:String(error);
   const busy=/store prune is running/u.test(why);
   this.receipt(busy?'STOP pnpm install waits: a pnpm store prune is running':`STOP pnpm install could not start: ${why}`);
   throw new StopError(`${why}\n${busy?'Run land again once the prune ends; the install is still owed and runs first.':'Fix that, then run land again; the install is still owed and runs first.'}`);
  }
  if(installed.status===0){rmSync(this.installMarker(),{force:true});return;}
  this.receipt(`STOP ${shown} failed after the rebase`);
  throw new StopError(`${shown} failed after the rebase (${moved.join(', ')} changed): ${`${installed.stderr}${installed.stdout}`.trim().split('\n').slice(-3).join(' ')}\nRun it by hand in the worktree, then run land again.`);
 }

 /** J249 provenance: what goes to main on the branch's green run must be exactly main plus that run's SHA. Git's own
  * three-way merge of the two is computed apart from the rebase, and the rebased HEAD must match it file for file; a
  * commit made during the rebase, or anything else, stops land (J206 review).
  * @param {string} main @param {string} tested */
 verifyReplay(main,tested){
  const merged=tryGit(this.root,['merge-tree','--write-tree','--name-only','--no-messages',main,tested]);
  const [tree='',...conflicted]=merged.stdout.split('\n').map(line=>line.trim()).filter(Boolean);
  const excluded=this.quarantined.length===0||this.config.flaky===null?[]:[`:(exclude)${this.config.flaky.quarantine}`];
  const same=SHA.test(tree)&&merged.status===0&&conflicted.length===0&&tryGit(this.root,['diff','--quiet',tree,'HEAD','--','.',...excluded]).status===0
   &&this.onlyQuarantineAdded(tree,'HEAD');
  if(same)return;
  this.receipt(`STOP rebased ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)}`);
  throw new StopError(`after the rebase, ${short(this.head())} is not main ${short(main)} plus the hosted-green ${short(tested)}: a commit or edit came in during the land. Check git log, keep what you meant, and run land again; a new commit gets its own branch CI.`);
 }

 /** Push the exact SHA to this worktree's own plan branch (LAND-SIMPLIFY LS4, J258). Land reads origin's real tip
  * (refreshing the remote-tracking ref, which a hand push by URL leaves stale) and rewrites it only when the local
  * branch's reflog reached it: a tip this worktree pushed, by land or by hand, or once held. Anything else is
  * someone else's push and stops land before any push. The push itself carries an explicit lease on that tip, so a
  * push landing in between is refused by git. This is `--force-if-includes`'s rule without its timestamp window,
  * which made git refuse a fresh fetch of the worktree's own tip (J206 review). No record files.
  * @param {string} sha */
 pushPlan(sha){
  const ref=`refs/heads/${this.branch}`,tracking=`refs/remotes/origin/${this.branch}`;
  if(git(this.root,['rev-parse',ref])!==sha)throw new StopError(`${this.branch} is not at ${short(sha)}; run land again`);
  const fetched=tryGitLocked(this.root,['fetch','--quiet','origin',`+${ref}:${tracking}`],process.env,this.retry);
  if(fetched.status!==0){
   // Only a branch origin lacks clears the tracking ref (a lease on "absent"); any other failure, the network or a
   // lock still held after the retries, stops here instead of passing for someone else's push.
   if(!/couldn't find remote ref/u.test(fetched.stderr))throw new StopError(`git fetch origin ${this.branch} failed: ${fetched.stderr.trim()}`);
   tryGitLocked(this.root,['update-ref','-d',tracking],process.env,this.retry);
  }
  const tip=tryGit(this.root,['rev-parse','--verify','--quiet',`${tracking}^{commit}`]).stdout.trim()||null;
  if(tip===sha){this.say('pushed',`${this.branch} already at ${short(sha)}`);this.planTip=sha;return;}
  const rewrite=tip!==null&&!isAncestor(this.root,tip,sha);
  if(rewrite&&!this.reached(tip)){
   this.receipt(`STOP plan push ${short(sha)} refused (origin has commits this worktree never had)`);
   throw new StopError(`origin ${this.branch} is at ${short(tip)}, which this worktree's branch never reached: someone else pushed it. Fetch and integrate their commits (git rebase origin/${this.branch}), then run land again; or start a new worktree with a new slug. Never force over it.`);
  }
  const args=['push','--porcelain',`--force-with-lease=${ref}:${tip??''}`,'origin',`${ref}:${ref}`];
  this.say('pushing',`${this.branch} ${short(sha)}${rewrite?` (rebased; replaces its own ${short(tip)} under a lease)`:''}; the pre-push runs`);
  const result=spawnSync('git',args,{cwd:this.root,env:this.env,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  if(result.status!==0){
   const leased=/\[rejected\].*\((?:stale info|fetch first)\)/u.test(result.stdout);
   this.receipt(`STOP plan push ${short(sha)} refused (${leased?'origin moved during the push':'pre-push red'})`);
   throw new StopError(leased
    ?`origin ${this.branch} moved while land pushed, so git refused the lease: someone else pushed it. Fetch and integrate their commits, then run land again. Never force over it.`
    :`push of ${this.branch} ${short(sha)} failed: ${result.stdout.trim()}\nA red pre-push names its failing check above; fix forward and run land again.`);
  }
  this.planTip=sha;
 }

 /** The local branch reached `tip`: some reflog entry of it is `tip` or a descendant (the newest 200).
  * @param {string} tip */
 /** TS10: re-run a red ci run's failed jobs once when every failure is a test file; on a green re-run, give each
  * file a strike and queue a quarantine for one with strikes from two plans in 24 h.
  * @param {string} sha @param {Awaited<ReturnType<Landing['waitCI']>>} verdict @returns {Promise<Awaited<ReturnType<Landing['waitCI']>>|null>} */
 async retryFlaky(sha,verdict){
  const flaky=this.config.flaky,gh=this.config.gh;
  if(flaky===null)return null;
  const run=verdict.runs[this.config.workflows[0]??'ci'];
  if(run===undefined||run.conclusion!=='failure'||run.attempt>1)return null;
  const jobs=runFailures(gh,this.repo,run.id);
  // A failure after the tests (the wall check after the artifact upload, a later step) is never a flaky file.
  if(!onlyPackedStepsFailed(gh,this.repo,run.id,flaky.packedStep))return null;
  mkdirSync(join(this.root,'tmp'),{recursive:true});
  const scratch=mkdtempSync(join(this.root,'tmp','land-flaky-'));
  /** @type {string[]|null} */let files=null;
  try{
   const fetched=spawnSync(gh,['run','download',String(run.id),'-R',this.repo,'-p',flaky.artifacts,'-D',scratch],{encoding:'utf8',timeout:120_000});
   if(fetched.status===0&&jobs.blocking.length>0)files=flakyFiles(scratch,jobs.blocking);
  }finally{rmSync(scratch,{recursive:true,force:true});}
  if(files===null)return null;
  this.say('flaky',`ci run ${run.id} red only on test files ${files.join(', ')}; re-running its failed jobs once (TS10)`);
  const rerun=spawnSync(gh,['run','rerun',String(run.id),'-R',this.repo,'--failed'],{encoding:'utf8',timeout:60_000});
  if(rerun.status!==0){this.say('flaky',`re-run refused (${rerun.stderr.trim().split('\n').at(-1)??''}); stopping as red`);return null;}
  // Wait for this run's own second attempt: never attempt one's stale verdict, never another run of the SHA.
  const deadline=Date.now()+this.options.timeoutMinutes*60_000;
  for(;;){
   /** @type {unknown} */let data=null;
   try{data=ghApi(gh,this.repo,`actions/runs/${run.id}`);}catch{/* retried below */}
   const field=(/** @type {string} */key)=>data!==null&&typeof data==='object'&&key in data?String(/** @type {Record<string,unknown>} */(data)[key]):'';
   if(Number(field('run_attempt'))>2){this.say('flaky',`ci run ${run.id} is past its second attempt; stopping as red`);return null;}
   if(Number(field('run_attempt'))===2&&field('status')==='completed'){
    if(field('conclusion')!=='success'){
     this.receipt(`TS10 re-run of ci ${run.id} red again on ${files.join(', ')}: not flaky; blocks only ${this.branch}`);
     return {...verdict,failed:[`ci run ${run.id} red on its re-run too (TS10): ${runFailures(gh,this.repo,run.id).blocking.join('; ')}`]};
    }
    break;
   }
   if(Date.now()>deadline)throw new StopError(`the TS10 re-run of ci ${run.id} did not finish in ${this.options.timeoutMinutes} min; run land again to keep waiting`);
   await sleep(this.options.pollSeconds*1000);
  }
  const again=await this.waitCI(sha,`${this.branch} re-run`);
  if(again.state!=='green')return again;
  const book=resolve(this.env.WS_FLAKE_STRIKES??join(homedir(),'.cache/wildshard/flake-strikes.jsonl')),now=Date.now();
  mkdirSync(dirname(book),{recursive:true});
  for(const file of files){
   appendFileSync(book,`${JSON.stringify({at:new Date(now).toISOString(),file,plan:this.branch,sha,run:run.id,lane:this.lane})}\n`);
   const plans=strikePlans(readFileSync(book,'utf8'),file,now);
   this.receipt(`TS10 strike: ${file} flaky on ci ${run.id} (red, then green on its re-run); plans with a strike in 24 h: ${plans.join(', ')}`);
   if(plans.length>=2)this.pendingQuarantine.push({file,plans,run:run.id});
  }
  return again;
 }

 /** TS10: commit the queued quarantine entries on this plan branch, dated to their addedAt (J193's history check);
  * true when a commit was made. The commit must sit on the tested HEAD and change only those entries. */
 quarantineCommit(){
  const flaky=this.config.flaky;
  if(this.pendingQuarantine.length===0||flaky===null)return false;
  const path=join(this.root,flaky.quarantine),added=[],now=Date.now(),parent=this.holds('before the TS10 quarantine');
  for(const {file,plans,run} of this.pendingQuarantine.splice(0)){
   const reason=`TS10 (J255): flaky on hosted CI, red then green on its re-run, with strikes from ${plans.join(' and ')} within 24 h (last: ci run ${run}); J200 deadline`;
   if(quarantineFile(path,file,this.env.WS_QUARANTINE_OWNER??flaky.owner,reason,now)){
    added.push(file);
    const written=/** @type {{entries:{file:string}[]}} */(JSON.parse(readFileSync(path,'utf8'))).entries.find(entry=>entry.file===file);
    if(written!==undefined)this.quarantinedEntries.push(written);
   }
  }
  if(added.length===0)return false;
  this.quarantined.push(...added);this.quarantineAt=Math.floor(now/1000);
  const message=`test: quarantine ${added.length===1?added[0]?.replace(/^.*\//u,'').replace(/\.test\.[cm]?[jt]s$/u,''):`${added.length} flaky files`}\n\nTEST-SPEED TS10 (J255): strikes from two plans within 24 h. Land added\nthis entry; it expires in 48 h (J200) and the TEST-SPEED lane owns it.\n\nAssisted-by: land:ts10-strikes`;
  const committed=spawnSync('git',['commit','--quiet','-m',message,'--',flaky.quarantine],{cwd:this.root,env:this.datedEnv(),encoding:'utf8'});
  if(committed.status!==0)throw new StopError(`TS10 quarantine commit failed: ${committed.stderr.trim()}`);
  this.checkQuarantineCommit(parent);
  this.say('quarantine',`${added.join(', ')} quarantined for 48 h on ${this.branch} ${short(this.expected)} (TS10: two plans' strikes in 24 h)`);
  this.receipt(`TS10 quarantined ${added.join(', ')} (commit ${short(this.expected)})`);
  return true;
 }

 /** After a rebase replays it, the quarantine commit takes back its addedAt date (J193 compares the commit time). */
 redateQuarantine(){
  if(this.quarantined.length===0||this.config.flaky===null)return;
  const parent=tryGit(this.root,['rev-parse','HEAD^']).stdout.trim();
  const amended=spawnSync('git',['commit','--quiet','--amend','--no-edit','--',this.config.flaky.quarantine],{cwd:this.root,env:this.datedEnv(),encoding:'utf8'});
  if(amended.status!==0)throw new StopError(`TS10 quarantine re-date failed: ${amended.stderr.trim()}`);
  this.checkQuarantineCommit(parent);
 }

 /** @returns {NodeJS.ProcessEnv} git's author and committer dates pinned to the quarantine's addedAt */
 datedEnv(){
  const date=`${String(this.quarantineAt)} +0000`;
  return {...this.env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date};
 }

 /** HEAD must be one commit on `parent` that changes only test/quarantine.json by land's own entries.
  * @param {string} parent */
 checkQuarantineCommit(parent){
  const head=this.head(),changed=tryGit(this.root,['diff','--name-only',parent,head]).stdout.trim();
  if(tryGit(this.root,['rev-parse',`${head}^`]).stdout.trim()!==parent||changed!==this.config.flaky?.quarantine||!this.onlyQuarantineAdded(parent,head)){
   this.receipt(`STOP TS10 quarantine commit ${short(head)} is not just land's entries on ${short(parent)}`);
   throw new StopError(`the TS10 quarantine commit ${short(head)} is not exactly land's entries on ${short(parent)}; nothing landed`);
  }
  this.expected=head;
 }

 /** True when `to`'s test/quarantine.json is `from`'s plus exactly land's entries (or equal when land added none).
  * @param {string} from @param {string} to */
 onlyQuarantineAdded(from,to){
  const quarantine=this.config.flaky?.quarantine;
  if(quarantine===undefined)return true;
  const read=(/** @type {string} */ref)=>{
   const shown=tryGit(this.root,['show',`${ref}:${quarantine}`]);
   if(shown.status!==0)return null;
   try{return /** @type {{entries:{file:string,addedAt?:string}[]}&Record<string,unknown>} */(JSON.parse(shown.stdout));}catch{return null;}
  };
  const before=read(from),after=read(to);
  if(this.quarantined.length===0)return JSON.stringify(before)===JSON.stringify(after);
  if(before===null||after===null||!Array.isArray(before.entries)||!Array.isArray(after.entries))return false;
  // Exactly the merged entries, then land's own entries byte for byte, in that order.
  return JSON.stringify(after)===JSON.stringify({...before,entries:[...before.entries,...this.quarantinedEntries]});
 }

 reached(tip){
  const entries=tryGit(this.root,['reflog','show','--format=%H','-n','200',`refs/heads/${this.branch}`]).stdout.split('\n').filter(line=>SHA.test(line));
  return [...new Set(entries)].some(entry=>entry===tip||isAncestor(this.root,tip,entry));
 }

 /** Poll the exact SHA until both landing workflows are complete.
  * @param {string} sha @param {string} what */
 async waitCI(sha,what){
  const deadline=Date.now()+this.options.timeoutMinutes*60_000,appear=Date.now()+this.options.appearMinutes*60_000;
  let last='';
  for(;;){
   /** @type {ReturnType<typeof shaVerdict>} */let verdict;
   try{verdict=shaVerdict(ghApi(this.config.gh,this.repo,`actions/runs?head_sha=${sha}&event=push&per_page=100`),sha,this.config.workflows);}
   catch(error){verdict={state:'pending',runs:{},summary:`lookup failed (${error instanceof Error?error.message:String(error)}); retrying`};}
   if(verdict.summary!==last){this.say('ci',`${what} ${short(sha)}: ${verdict.summary}`);last=verdict.summary;}
   if(verdict.state==='green'){for(const run of Object.values(verdict.runs))this.runs.push(run.id);return verdict;}
   if(verdict.state==='red'){
    // The run conclusion decides, never a job list: quarantine jobs are continue-on-error, so they can't make a run
    // red on their own, and a list (paged, re-run, cancelled) can't prove the blocking jobs passed. The stop line
    // names the blocking failures and sets the quarantine reds apart, so nobody chases a non-blocking job.
    const reds=Object.entries(verdict.runs).filter(([,run])=>run.conclusion!=='success').map(([name,run])=>({name,run,jobs:runFailures(this.config.gh,this.repo,run.id)}));
    const failed=reds.map(({name,run,jobs})=>`${name} run ${run.id} ${run.conclusion}: ${jobs.blocking.join('; ')||'no blocking failed job listed'}${jobs.nonblocking.length===0?'':` (non-blocking: ${jobs.nonblocking.join('; ')})`}${run.url===''?'':` ${run.url}`}`);
    return {...verdict,failed};
   }
   if(Object.keys(verdict.runs).length===0&&Date.now()>appear)throw new StopError(`no hosted ci run for ${short(sha)} after ${this.options.appearMinutes} min; is ci.yml triggered on plan/** pushes?`);
   if(Date.now()>deadline)throw new StopError(`hosted CI for ${short(sha)} not finished after ${this.options.timeoutMinutes} min (${verdict.summary}); run land again to keep waiting`);
   await sleep(this.options.pollSeconds*1000);
  }
 }

 /** Fast-forward main to HEAD. Refuses before pushing unless origin/main is
  * an ancestor; the refspec has no `+` and no force flag ever.
  * @param {boolean} carried @returns {'landed'|'moved'} */
 pushMain(carried){
  const head=this.holds('before the merge'),main=this.fetchMain();
  if(!isAncestor(this.root,main,head))return 'moved';
  if(main===head)return 'landed';
  const args=mainPushArgs(head);
  this.say('merging',`main ${short(main)} -> ${short(head)} fast-forward only${carried?'; static pre-push on the rebased tree, no Vitest (LS3)':'; the hosted-green SHA, no local gate'}`);
  // LS3 (J258): the pre-push knows this is land's main push and of which kind (.githooks/run-checks.mjs).
  const env={...this.env,WS_LAND_MAIN_PUSH:`${carried?'carried':'exact'}:${head}`};
  const result=spawnSync('git',args,{cwd:this.root,env,encoding:'utf8',stdio:['ignore','pipe','inherit']});
  if(result.status===0)return 'landed';
  // A lost race is main having moved; anything else (a red pre-push) stops.
  const now=this.fetchMain();
  if(now!==main&&!isAncestor(this.root,now,head))return 'moved';
  this.receipt(`STOP main push of ${short(head)} refused: ${result.stdout.trim().split('\n').slice(-2).join(' ')}`);
  throw new StopError(`main push of ${short(head)} failed and main did not move: ${result.stdout.trim()}\nA red pre-push names its failing check above; fix forward and run land again.`);
 }

 async run(){
  this.clean();
  const start=this.head();this.expected=start;
  let main=this.fetchMain();
  if(start===main||isAncestor(this.root,start,main)){this.say('nothing',`${this.branch} ${short(start)} has nothing main lacks`);return 0;}
  this.say('start',`${this.branch} ${short(start)} -> main ${short(main)} (repo ${this.repo})`);
  // An install a stopped land owed (its rebase had already moved HEAD) runs before anything else (J206 review).
  if(existsSync(this.installMarker()))this.install(['an earlier land\'s rebase']);
  if(!isAncestor(this.root,main,start)){
   this.rebase(main);
   if(this.head()===main){this.say('nothing',`every commit on ${this.branch} is already on main`);return 0;}
  }
  /** @type {{sha:string,base:string}|null} */let tested=null;
  let needHosted=true,rule='exact',why='main had not moved since the hosted run';
  for(let round=1;round<=this.options.rounds;round++){
   if(needHosted){
    const sha=this.holds('before the branch push');
    this.pushPlan(sha);
    let verdict=await this.waitCI(sha,this.branch);
    this.holds('while hosted CI ran');
    if(verdict.state==='red'){
     const retried=await this.retryFlaky(sha,verdict);
     if(retried!==null){verdict=retried;this.holds('while the re-run ran');}
    }
    if(verdict.state!=='green'){
     const failed='failed'in verdict?verdict.failed:[];
     this.receipt(`STOP hosted CI red for ${short(sha)}: ${failed.join(' | ')}`);
     throw new StopError(`hosted CI is red for ${short(sha)}; main is unchanged.\n  ${failed.join('\n  ')}\nFix forward on ${this.branch} and run land again.`);
    }
    tested={sha,base:git(this.root,['merge-base',sha,'refs/remotes/origin/main'])};
    needHosted=false;rule='exact';why='main had not moved since the hosted run';
    if(this.quarantineCommit()){rule='carried';why=`TS10 quarantine on top of the branch's green run ${short(sha)}: it only adds ${this.config.flaky?.quarantine??'quarantine'} entries`;}
   }
   if(tested===null)throw new Error('unreachable: no hosted-tested SHA');
   main=this.fetchMain();
   if(!isAncestor(this.root,main,this.holds('before the rebase'))){
    this.say('moved',`main moved to ${short(main)}; rebasing (round ${round})`);
    this.rebase(main);
    this.verifyReplay(main,tested.sha);
    this.redateQuarantine();
    rule='carried';why=`clean rebase onto ${short(main)}: the branch's green run ${short(tested.sha)} carries (J249)`;
    this.say('carried',why);
   }
   const outcome=this.pushMain(rule==='carried');
   if(outcome==='moved'){this.say('moved','main moved during the merge; rebasing and retrying');continue;}
   return this.landed(rule,why,round,main);
  }
  this.receipt(`STOP gave up after ${this.options.rounds} tries; main kept moving`);
  throw new StopError(`main kept moving: ${this.options.rounds} tries each lost the race to another push (J258 stops at 5). Nothing landed; run land again when main is quieter`);
 }

 /** After GitHub's main moved, bring the canonical checkout's main along (Jake, 2026-11-10 ~23:50 Cancún: "go to
  * the main checkout, pull main, make sure it's up to date, and then merge fast forward only in the main checkout").
  * The push came first, so the canonical checkout is never ahead of GitHub. Only a fast-forward, under worktree.mjs's
  * followMain guards (on main, clean, not diverged, no git operation in progress); anything else is a
  * warning and a receipt, never a reset or a stash. The landing stands either way. */
 followCanonical(){
  let canonical='',outcome='';
  try{
   canonical=canonicalRoot(this.root);
   const fetched=tryGitLocked(canonical,['fetch','--quiet','origin','main'],process.env,this.retry);
   if(fetched.status!==0)throw new Error(`git fetch origin main failed: ${fetched.stderr.trim()}`);
   outcome=followMain(canonical,git(canonical,['rev-parse','origin/main']).trim());
  }catch(error){outcome=`could not check it (${error instanceof Error?error.message.split('\n')[0]:String(error)})`;}
  if(/fast-forwarded|current$/u.test(outcome)){this.say('canonical',outcome);return;}
  this.say('canonical',`WARNING ${outcome}; canonical ${canonical||'checkout'} was not updated`);
  this.receipt(`canonical checkout not fast-forwarded after landing: ${outcome}`);
 }

 /** LAND-SIMPLIFY LS5 (J258): main's verdict belongs to scripts/main-watch.mjs. It follows this SHA in the
  * background until main's ci judges it, writes the receipt and messages this pane on red. It runs from the
  * canonical checkout, so it outlives this worktree. WS_MAIN_WATCH=0 turns it off.
  * @param {string} head */
 startWatcher(head){
  const own=join(this.root,'scripts/main-watch.mjs');
  if(this.env.WS_MAIN_WATCH==='0'||!existsSync(own))return;
  // Run the canonical checkout's copy when it has one: this worktree may be removed before node has read its own
  // (J206 review). Otherwise a private copy, rooted at the canonical checkout.
  const canonical=canonicalRoot(this.root),shared=join(canonical,'scripts/main-watch.mjs');
  let script=shared,env=this.env;
  if(!existsSync(shared)){
   script=join(homedir(),'.cache/wildshard/main-watch/main-watch.mjs');
   mkdirSync(dirname(script),{recursive:true});writeFileSync(script,readFileSync(own));
   env={...this.env,WS_MAIN_WATCH_ROOT:canonical};
  }
  const args=[script,`--follow=${head}`,`--lane=${this.lane}`,...(this.env.HERDR_PANE_ID?[`--pane=${this.env.HERDR_PANE_ID}`]:[])];
  try{
   spawn(process.execPath,args,{cwd:canonical,env,detached:true,stdio:'ignore'}).unref();
   this.say('watch',`main-watch follows ${short(head)} and reports main's ci (receipt, and a message here on red)`);
  }catch(error){this.say('watch',`main-watch not started (${error instanceof Error?error.message:String(error)}); run node scripts/main-watch.mjs by hand`);}
 }

 /** LS5 (J258, Jake: "Yes, land cleans up its own"): after landing, delete origin's plan branch (under a lease on the
  * SHA land pushed) and remove this worktree with its local branch, from the canonical checkout. A worktree with
  * uncommitted or untracked work is kept and named. The reaper stays only for abandoned worktrees.
  * @returns {string} what happened */
 cleanUp(){
  const head=this.landedSha;
  if(head===null)return 'nothing landed';
  const canonical=canonicalRoot(this.root),parts=[];
  if(this.planTip!==null){
   const deleted=tryGit(this.root,['push','--quiet',`--force-with-lease=refs/heads/${this.branch}:${this.planTip}`,'origin','--delete',this.branch]);
   parts.push(deleted.status===0?`origin ${this.branch} deleted`:`origin ${this.branch} kept (${deleted.stderr.trim().split('\n').at(-1)??'push refused'})`);
  }
  const dirty=tryGit(this.root,['status','--porcelain']).stdout.trim();
  const now=tryGit(this.root,['symbolic-ref','--quiet','HEAD']).stdout.trim(),at=tryGit(this.root,['rev-parse','HEAD']).stdout.trim();
  if(now!==`refs/heads/${this.branch}`||at!==head)parts.push(`worktree kept: HEAD moved off ${this.branch} ${short(head)} after landing`);
  else if(dirty!=='')parts.push(`worktree kept: ${dirty.split('\n').length} uncommitted or untracked path(s)`);
  else{
   // TEST-SPEED FL30: nothing started here may outlive the folder (an orphaned Vitest held the CPU slots).
   let stopped=[];
   try{stopped=stopWorktreeProcesses(realpathSync(this.root));}catch{/* Listing failed: remove as before. */}
   if(stopped.length>0)parts.push(`stopped ${String(stopped.length)} process(es) still running there (pid ${stopped.join(', ')})`);
   const removed=tryGit(canonical,['worktree','remove',this.root]);
   if(removed.status===0){
    tryGitLocked(canonical,['update-ref','-d',`refs/heads/${this.branch}`,head],process.env,this.retry);
    parts.push(`worktree and ${this.branch} removed; continue from ${canonical}`);
   }else parts.push(`worktree kept (${removed.stderr.trim().split('\n').at(-1)??'git worktree remove refused'})`);
  }
  const line=parts.join('; ');
  this.say('cleaned',line);
  return line;
 }

 /** @param {string} rule @param {string} why @param {number} round @param {string} before */
 landed(rule,why,round,before){
  const head=this.head();
  this.say('landed',`main ${short(before)} -> ${short(head)} (${rule}: ${why})`);
  this.landedSha=head;
  this.followCanonical();
  this.startWatcher(head);
  this.say('rule',`main's own CI runs on ${short(head)} now. If it goes red, the lane that landed last fixes it forward or reverts it, at once (J249)`);
  const seconds=Math.round((Date.now()-this.started)/1000);
  this.receipt(`landed ${short(head)} on main (${short(before)}..${short(head)}); ${rule}; rounds ${round}; branch ci ${this.runs.join(', ')||'none'}; main ci ${rule==='carried'?'followed by main-watch':'reuses the branch run'}; ${seconds} s`);
  return 0;
 }
}

/** The only main push land makes: the exact SHA, an explicit non-forced refspec.
 * @param {string} sha */
export function mainPushArgs(sha){
 if(!SHA.test(sha))throw new Error('land pushes an exact SHA to main');
 const args=['push','--porcelain','origin',`${sha}:refs/heads/main`];
 if(args.some(arg=>arg.startsWith('+')||/force|^-f$/u.test(arg)))throw new Error('land never forces main');
 return args;
}

/** Land the worktree at `cwd`; resolves to the exit code.
 * @param {string[]} argv @param {string} [cwd] @param {NodeJS.ProcessEnv} [env] */
export async function land(argv,cwd=process.cwd(),env=process.env){
 /** @type {(() => void)|null} */let unlock=null;
 try{
  const landing=new Landing(cwd,parseArgs(argv),env);
  unlock=landing.lock();
  const code=await landing.run();
  // Cleanup runs under the land lock (J206 review): no second land can start here meanwhile. The lock file lives in
  // this worktree's git dir, so removing the worktree removes it too; the release below then finds nothing.
  if(!landing.options.keep)landing.cleanUp();
  return code;
 }catch(error){
  if(error instanceof StopError){process.stdout.write(`land STOP ${error.message}\n`);return 1;}
  throw error;
 }finally{unlock?.();}
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await land(process.argv.slice(2));
