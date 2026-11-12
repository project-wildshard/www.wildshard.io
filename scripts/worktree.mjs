// DEV-SPEED DS12 (J221, J240): `node scripts/worktree.mjs new <slug>` makes a plan worktree at
// <canonical>/.worktrees/<slug> on plan/<slug> from origin/main, ready to work in and land from.
//
//   1. a short per-repo setup lock, then `git fetch origin main`, a fast-forward of the canonical checkout's main when
//      it is clean and only behind (followMain: never a reset), and `git worktree add --no-checkout`;
//   2. the tracked tree: a file whose blob and mode match a clean regular file of the canonical checkout, with no
//      checkout conversion (filter, eol, text, ident, encoding), is an APFS clone of it (copy-on-write, no new
//      blocks); every clone is then hashed raw against its blob and mode-checked, and a mismatch is deleted; git
//      writes the rest; `git status` must then be clean and the hooks live, or setup takes its worktree back;
//   3. `pnpm install --frozen-lockfile --offline`: pnpm's store, cloned, not downloaded;
//   4. `pnpm pins` when the repo has that script (shard products from ~/.cache/wildshard/pins);
//   5. names the herdr pane (inside herdr only) and prints the land steps.
// Before step 1 adds anything, meta REPO-DISK DK9 (Q41): it refuses when the repo's volume has under MIN_FREE_GIB
// free or the repo already has MAX_WORKTREES live worktrees under .worktrees/, and names the oldest parked one.
// WS_WORKTREE_FREE_GIB stands in for the measured free GiB (tests); setting it is a deliberate override.
//
// Never copied: .env*, tmp/, .review/, .cache/, browser profiles, leases, ports, push proofs; the worktree gets
// only tracked files and its own install. Each step's seconds go to <worktree>/tmp/worktree-setup.json and, with
// WS_LANE_NAME set, one line in ~/.cache/wildshard/lane-receipts.log. Removal is DS13's reaper: `reap`
// (scripts/worktree-reap.mjs) removes landed, clean, idle worktrees with their branches, local and on origin.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {appendFileSync,existsSync,linkSync,lstatSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync,statfsSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {WORKTREES} from './worktree-ignore.mjs';
import {lastActivity,linkedWorktrees,onMain,parseReapArgs,reap} from './worktree-reap.mjs';

export const SLUG=/^[a-z0-9][a-z0-9._-]{0,63}$/u;
const REGULAR=/^100(?:644|755)$/u;
/** The hooks a commit and a push must run, when the repo tracks them. */
const HOOKS=['pre-commit','commit-msg','pre-push'];
/** A lock older than this is abandoned whatever its pid says (pids are reused); the locked part takes seconds. */
const STALE_MS=10*60_000;
// fclonefileat(2) per file, one process for the whole tree: Node's COPYFILE_FICLONE makes a full copy on macOS
// (measured: ATTR_CMNEXT_PRIVATESIZE equals the file size) and COPYFILE_FICLONE_FORCE fails with ENOSYS. Each source
// is opened without following a final symlink and must be a regular file, so a path swapped for a directory or a
// link is never cloned; every clone is hashed afterwards anyway. Reads source/target pairs, NUL-separated, on stdin.
const CLONEFILE=`import ctypes, os, stat, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.fclonefileat.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
AT_FDCWD = -2
parts = sys.stdin.buffer.read().split(b'\\0')[:-1]
for source, target in zip(parts[0::2], parts[1::2]):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            sys.exit(f'{source.decode()}: not a regular file')
        if libc.fclonefileat(fd, AT_FDCWD, target, 0) != 0:
            sys.exit(f'{target.decode()}: {os.strerror(ctypes.get_errno())}')
    finally:
        os.close(fd)`;
const USAGE='usage: node scripts/worktree.mjs new <slug> [--no-install] [--no-pins] [--no-herdr] [--no-clone]\n       node scripts/worktree.mjs reap [--dry-run] [--grace=HOURS] [--no-remote]';

class StopError extends Error{name='StopError';}

/** @param {string} cwd @param {string[]} args @param {string} [input] */
const git=(cwd,args,input)=>execFileSync('git',args,{cwd,encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:256<<20});
/** @param {string} cwd @param {string[]} args */
const tryGit=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:256<<20});
const nul=(/** @type {string} */ text)=>text.split('\0').filter(Boolean);

/**
 * GVS G10 (J230): run a store install only while no pnpm store prune runs. This install is announced in
 * `store-users/` before it checks the prune's reservation (an exclusive flock its pnpm child inherits), and the prune
 * takes that lock before it scans, so one of the two always sees the other (meta scripts/prune-store.sh). Paths can
 * be moved for tests.
 * @template T @param {NodeJS.ProcessEnv} env @param {string} what @param {() => T} fn @returns {T}
 */
export function withStoreUse(env,what,fn){
 const users=env.WS_STORE_USERS??join(homedir(),'.cache/wildshard/store-users');
 const reservation=env.WS_STORE_RESERVATION??join(homedir(),'.cache/wildshard/store-maintenance.lock');
 mkdirSync(users,{recursive:true});
 const mine=join(users,`${process.pid}.json`);
 writeFileSync(mine,JSON.stringify({pid:process.pid,what,at:Date.now()}));
 try{
  // The prune holds an exclusive flock that its pnpm child inherits; Node has no flock, so Python probes it.
  const probe=spawnSync('python3',['-c','import fcntl,sys\ntry:\n f=open(sys.argv[1],"rb")\nexcept OSError:\n sys.exit(0)\ntry:\n fcntl.flock(f,fcntl.LOCK_SH|fcntl.LOCK_NB)\nexcept BlockingIOError:\n sys.exit(3)\n',reservation],{encoding:'utf8'});
  if(probe.status===3)throw new Error('worktree: a pnpm store prune is running (meta make prune); run this again when it ends');
  if(probe.status!==0)throw new Error(`worktree: could not check the store prune reservation (${probe.error?.message??probe.stderr.trim()})`);
  return fn();
 }finally{rmSync(mine,{force:true});}
}

/** Meta REPO-DISK DK9 (DEV-SPEED Q41): at most this many live plan worktrees per repo. */
export const MAX_WORKTREES=6;
/** Meta REPO-DISK DK9: refuse a new worktree when the repo's volume has less free than this, in GiB. */
export const MIN_FREE_GIB=60;

/** Free GiB on the volume holding `path`; WS_WORKTREE_FREE_GIB fakes it (tests). @param {string} path @param {NodeJS.ProcessEnv} env */
export function freeGib(path,env){
 const faked=env.WS_WORKTREE_FREE_GIB;
 if(faked!==undefined&&faked!==''){
  const value=Number(faked);
  if(!Number.isFinite(value)||value<0)throw new StopError(`WS_WORKTREE_FREE_GIB=${faked} is not a number of GiB`);
  return value;
 }
 const volume=statfsSync(path);
 return Number(volume.bavail)*Number(volume.bsize)/2**30;
}

/**
 * DK9: why `worktree new` must not add another worktree here, or '' when it may. Live means a registered worktree
 * whose folder exists under <canonical>/.worktrees/. A refusal names the oldest parked one (on plan/<slug>, landed:
 * its tip on origin/main, and clean), by its last Git activity, and the reap command that frees it.
 * @param {string} canonical @param {NodeJS.ProcessEnv} env @returns {string}
 */
export function capRefusal(canonical,env){
 const roots=new Set([join(canonical,WORKTREES),join(realpathSync(canonical),WORKTREES)]);
 const live=linkedWorktrees(canonical).filter(tree=>roots.has(dirname(resolve(tree.path)))&&existsSync(tree.path));
 const free=freeGib(canonical,env);
 const full=live.length>=MAX_WORKTREES,low=free<MIN_FREE_GIB;
 if(!full&&!low)return '';
 const why=[
  ...(full?[`${basename(canonical)} already has ${String(live.length)} live worktrees under ${WORKTREES}/ (cap ${String(MAX_WORKTREES)})`]:[]),
  ...(low?[`only ${free.toFixed(1)} GiB free on the volume of ${canonical} (floor ${String(MIN_FREE_GIB)} GiB)`]:[]),
 ].join(', and ');
 const parked=live.flatMap(tree=>{
  const slug=basename(tree.path);
  if(tree.branch!==`refs/heads/plan/${slug}`||!onMain(canonical,tree.head))return [];
  // Activity first, and a status that takes no optional lock: a plain `git status` may rewrite the index and so
  // make every worktree look active now.
  const at=lastActivity(tree.path,git(tree.path,['rev-parse','--absolute-git-dir']).trim());
  const dirty=spawnSync('git',['--no-optional-locks','status','--porcelain','--untracked-files=all'],{cwd:tree.path,encoding:'utf8',maxBuffer:64<<20});
  if(dirty.status!==0||dirty.stdout.trim()!=='')return [];
  return [{slug,at}];
 }).sort((a,b)=>a.at-b.at);
 const oldest=parked[0];
 const hint=oldest===undefined
  ?`none of them is parked (landed on origin/main and clean): land one, or remove one by hand`
  :`the oldest parked worktree is ${WORKTREES}/${oldest.slug} (landed, clean, idle ${((Date.now()-oldest.at)/3_600_000).toFixed(1)} h); \`node scripts/worktree.mjs reap\` frees it once idle 24 h with no process inside, or land and remove one by hand`;
 return `${why}; ${hint}`;
}

/** @param {string[]} argv */
export function parseArgs(argv){
 const [command,slug,...rest]=argv;
 if(command!=='new'||slug===undefined)throw new StopError(USAGE);
 if(!SLUG.test(slug))throw new StopError(`slug "${slug}" must match ${SLUG.source}`);
 const flags=new Set(['--no-install','--no-pins','--no-herdr','--no-clone']);
 const unknown=rest.filter(arg=>!flags.has(arg));
 if(unknown.length>0)throw new StopError(`unknown option ${unknown.join(' ')}\n${USAGE}`);
 return {slug,install:!rest.includes('--no-install'),pins:!rest.includes('--no-pins'),herdr:!rest.includes('--no-herdr'),clone:!rest.includes('--no-clone')};
}

/** The canonical checkout of the repo `cwd` is in: the main worktree, never a linked one. @param {string} cwd */
export function canonicalRoot(cwd){
 const common=resolve(cwd,git(cwd,['rev-parse','--git-common-dir']).trim());
 if(basename(common)!=='.git')throw new StopError(`${common} is not a checkout's .git (a bare repository has no canonical tree)`);
 return dirname(common);
}

/** `git ls-files -s -z` as path -> "<mode> <oid>". @param {string} cwd */
function stagedBlobs(cwd){
 /** @type {Map<string,string>} */const blobs=new Map();
 for(const row of nul(git(cwd,['ls-files','-s','-z']))){
  const match=/^(\d{6}) ([0-9a-f]{40,64}) 0\t(.+)$/su.exec(row);
  if(match!==null)blobs.set(match[3]??'',`${match[1]} ${match[2]}`);
 }
 return blobs;
}

/** Paths whose checkout would not write the raw blob, from the target's own attributes: a filter, an eol, a
 * working-tree encoding, ident expansion, or text conversion when the config asks for CRLF.
 * @param {string} tree @param {string[]} paths @returns {Set<string>} */
function convertedPaths(tree,paths){
 const converted=new Set();
 if(paths.length===0)return converted;
 // --type=bool reads yes/1/TRUE as true; `input` is not a bool and converts nothing on checkout.
 const crlf=tryGit(tree,['config','--type=bool','core.autocrlf']).stdout.trim()==='true'||tryGit(tree,['config','core.eol']).stdout.trim().toLowerCase()==='crlf';
 const rows=nul(git(tree,['check-attr','--cached','-z','--stdin','filter','eol','text','ident','working-tree-encoding'],`${paths.join('\0')}\0`));
 for(let index=0;index+2<rows.length;index+=3){
  const path=rows[index]??'',attribute=rows[index+1],value=rows[index+2];
  const plain=value==='unspecified'||value==='unset'||(attribute==='text'&&!crlf);
  if(!plain||(attribute==='text'&&crlf&&value!=='unset'))converted.add(path);
 }
 return converted;
}

/** Clone into `tree` each tracked file the canonical checkout holds clean with the same blob and mode, then keep only
 * clones whose raw bytes hash to their blob and whose mode matches. @param {string} canonical @param {string} tree
 * @returns {number} files kept */
function cloneTrackedFiles(canonical,tree){
 const source=stagedBlobs(canonical),target=stagedBlobs(tree);
 // Hidden edits count as dirty: modified, deleted, staged, assume-unchanged (lowercase tag) or skip-worktree (S).
 const dirty=new Set(nul(git(canonical,['ls-files','-z','--modified','--deleted'])));
 for(const path of nul(git(canonical,['diff','--cached','--name-only','-z'])))dirty.add(path);
 for(const row of nul(git(canonical,['ls-files','-z','-v'])))if(/^(?:[a-z]|S) /u.test(row))dirty.add(row.slice(2));
 const candidates=[...target].filter(([path,blob])=>source.get(path)===blob&&!dirty.has(path)&&REGULAR.test(blob.slice(0,6))).map(([path])=>path);
 const converted=convertedPaths(tree,candidates);
 /** @type {string[]} */const cloned=[];
 /** @type {string[]} */const pairs=[];
 for(const path of candidates){
  // hash-object --stdin-paths is line-based: a name with a newline is left to git.
  if(converted.has(path)||path.includes('\n'))continue;
  try{if(!lstatSync(join(canonical,path)).isFile())continue;}catch{continue;}
  mkdirSync(dirname(join(tree,path)),{recursive:true});
  pairs.push(join(canonical,path),join(tree,path));
  cloned.push(path);
 }
 if(pairs.length===0)return 0;
 const result=spawnSync('python3',['-I','-c',CLONEFILE],{input:`${pairs.join('\0')}\0`,encoding:'utf8',maxBuffer:64<<20});
 if(result.status!==0)process.stderr.write(`worktree: clone stopped early (${result.stderr.trim()===''?result.error?.message??'failed':result.stderr.trim()}); git writes the rest\n`);
 // The raw bytes of every clone hash to its blob, and its mode is the index's; anything else is deleted for git.
 // If the check itself fails, no clone is trusted: all of them go, and git writes every file.
 let kept=0;
 try{
  const present=cloned.filter(path=>existsSync(join(tree,path)));
  const hashes=present.length===0?[]:git(tree,['hash-object','--no-filters','--stdin-paths'],`${present.join('\n')}\n`).trim().split('\n');
  if(hashes.length!==present.length)throw new Error(`hash-object returned ${String(hashes.length)} hashes for ${String(present.length)} files`);
  present.forEach((path,index)=>{
   const [mode,oid]=(target.get(path)??'').split(' '),stat=lstatSync(join(tree,path));
   if(hashes[index]===oid&&stat.isFile()&&((stat.mode&0o100)!==0)===(mode==='100755'))kept++;
   else rmSync(join(tree,path),{force:true});
  });
 }catch(error){
  for(const path of cloned)rmSync(join(tree,path),{force:true});
  process.stderr.write(`worktree: clone check failed (${error instanceof Error?error.message:String(error)}); git writes every file\n`);
  return 0;
 }
 return kept;
}

/** Git states in which moving HEAD would break an operation someone is part way through. */
const BUSY_GIT=['index.lock','MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','rebase-merge','rebase-apply','sequencer'];

/** Keep the canonical checkout on origin/main (Jake, 2026-11-10: "If the main checkout of the engine is stale, we
 * definitely need to get it up to date"). A plain fast-forward when it is on main, clean and behind: no tracked edit,
 * nothing staged, no commit origin/main lacks, and no merge, rebase, am, cherry-pick, revert, bisect or index lock in
 * progress. `git merge --ff-only` itself refuses a dirty tree or diverged history, never overwrites an ignored or
 * untracked file and never autostashes. A terminal or dev server sitting in the folder doesn't stop it (coordinator,
 * 2026-11-11: that check skipped every land, mostly for stale preview servers). Anything else is one line saying why
 * it was left alone, never a reset.
 * @param {string} canonical @param {string} base origin/main @returns {string} what it did, for the step line */
export function followMain(canonical,base){
 const branch=tryGit(canonical,['symbolic-ref','--quiet','HEAD']).stdout.trim();
 if(branch!=='refs/heads/main')return `canonical not on main (${branch===''?'detached':branch}); left alone`;
 const head=git(canonical,['rev-parse','HEAD']).trim();
 if(head===base)return 'canonical main current';
 const [ahead='0',behind='0']=git(canonical,['rev-list','--left-right','--count',`${head}...${base}`]).trim().split(/\s+/u);
 if(ahead!=='0')return `CANONICAL MAIN DIVERGED: ${ahead} ahead, ${behind} behind origin/main; left alone, tell the coordinator`;
 const leave=(/** @type {string} */ why)=>`canonical main ${behind} behind; ${why}; left alone`;
 if(git(canonical,['status','--porcelain','--untracked-files=no']).trim()!=='')return leave('tracked edits');
 const busy=BUSY_GIT.find(name=>existsSync(resolve(canonical,git(canonical,['rev-parse','--git-path',name]).trim())));
 if(busy!==undefined)return leave(`git ${busy} in progress`);
 // Last look right before the merge (J206 review): merge --ff-only would happily move another branch's HEAD.
 if(tryGit(canonical,['symbolic-ref','--quiet','HEAD']).stdout.trim()!=='refs/heads/main'||git(canonical,['rev-parse','HEAD']).trim()!==head)return leave('HEAD moved during the check');
 const merged=tryGit(canonical,['merge','--ff-only','--no-autostash','--no-overwrite-ignore','--quiet',base]);
 if(merged.status!==0&&git(canonical,['rev-parse','HEAD']).trim()!==head)return `CANONICAL MAIN NEEDS A LOOK: the fast-forward failed after HEAD moved (${merged.stderr.trim().split('\n')[0]})`;
 return merged.status===0?`canonical main fast-forwarded ${behind} commit(s)`:leave(`fast-forward refused (${merged.stderr.trim().split('\n')[0]})`);
}

/** The repo's hooks must be live in the worktree: core.hooksPath inside it, and each tracked hook executable there.
 * @param {string} tree */
function checkHooks(tree){
 const configured=tryGit(tree,['config','core.hooksPath']).stdout.trim();
 const tracked=new Set(nul(git(tree,['ls-files','-z','--','.githooks'])));
 if(tracked.size===0&&configured==='')return;
 if(configured==='')throw new StopError(`core.hooksPath is unset but the repo tracks .githooks/; run git config core.hooksPath .githooks in the canonical checkout`);
 const directory=resolve(tree,configured);
 if(!directory.startsWith(`${tree}/`))throw new StopError(`core.hooksPath ${configured} resolves outside the worktree (${directory})`);
 for(const hook of HOOKS){
  const path=join(directory,hook);
  if(!tracked.has(`.githooks/${hook}`))continue;
  let mode=0;
  try{mode=statSync(path).mode;}catch{/* Missing: refused below. */}
  if((mode&0o111)===0)throw new StopError(`hook ${hook} is missing or not executable at ${path}`);
 }
}

/** A short per-repo setup lock in the shared Git dir. It is created with its owner already in it (a hard link of a
 * written file) and released only by its owner. An abandoned lock is never taken over automatically, because no
 * takeover is race-free without a process-held lock: the refusal names it and the command that clears it.
 * @param {string} common @returns {() => void} */
function lock(common){
 const path=join(common,'wildshard-worktree-setup.lock'),token=`${process.pid} ${Date.now()} ${randomBytes(6).toString('hex')}`;
 const draft=`${path}.${randomBytes(6).toString('hex')}`;
 writeFileSync(draft,token);
 try{
  linkSync(draft,path);
  return ()=>{try{if(readFileSync(path,'utf8')===token)unlinkSync(path);}catch{/* Already gone. */}};
 }catch(error){
  if(!(error instanceof Error)||!('code' in error)||error.code!=='EEXIST')throw error;
  let held='';
  try{held=readFileSync(path,'utf8');}catch{/* Released meanwhile. */}
  const [pid,since]=held.split(' ').map(Number);
  let alive=false;
  try{if(pid!==undefined&&Number.isInteger(pid)&&pid>0){process.kill(pid,0);alive=true;}}catch{/* The holder is gone. */}
  const age=since===undefined||!Number.isFinite(since)?'unknown':`${String(Math.round((Date.now()-since)/1000))} s`;
  if(alive&&since!==undefined&&Date.now()-since<STALE_MS)throw new StopError(`another worktree setup (pid ${String(pid)}, ${age}) holds ${path}; retry when it finishes`);
  throw new StopError(`${path} looks abandoned (pid ${String(pid)} ${alive?'reused':'gone'}, age ${age}); if no worktree setup is running, rm ${path} and retry`);
 }finally{unlinkSync(draft);}
}

/** @param {string} cwd @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} env */
function run(cwd,command,args,env){
 const result=spawnSync(command,args,{cwd,env,stdio:['ignore','inherit','inherit']});
 if(result.error!==undefined)throw new StopError(`${command} ${args.join(' ')}: ${result.error.message}`);
 if(result.status!==0)throw new StopError(`${command} ${args.join(' ')} exited ${String(result.status)}`);
}

/** @param {string[]} argv @param {string} [cwd] @param {NodeJS.ProcessEnv} [env] @returns {number} */
export function worktreeNew(argv,cwd=process.cwd(),env=process.env){
 const options=parseArgs(argv),canonical=canonicalRoot(cwd),common=join(canonical,'.git');
 const relative=`${WORKTREES}/${options.slug}`,tree=join(canonical,relative),branch=`plan/${options.slug}`;
 /** @type {{step:string,seconds:number,detail?:string}[]} */const steps=[];
 const began=performance.now();
 /** @param {string} step @param {() => (string|void)} work */
 const timed=(step,work)=>{
  const started=performance.now(),detail=work();
  steps.push({step,seconds:Number(((performance.now()-started)/1000).toFixed(2)),...(typeof detail==='string'?{detail}:{})});
  process.stdout.write(`worktree ${step.padEnd(8)} ${(steps.at(-1)?.seconds??0).toFixed(1)} s${typeof detail==='string'?`  ${detail}`:''}\n`);
 };
 const unlock=lock(common);
 let base='';
 try{
  if(existsSync(tree))throw new StopError(`${relative} already exists; work there, or pick another slug`);
  if(tryGit(canonical,['rev-parse','--verify','--quiet',`refs/heads/${branch}`]).status===0)throw new StopError(`branch ${branch} already exists; delete it or pick another slug`);
  timed('fetch',()=>{git(canonical,['fetch','--quiet','origin','main']);base=git(canonical,['rev-parse','origin/main']).trim();return `origin/main ${base.slice(0,10)}; ${followMain(canonical,base)}`;});
  // DK9: after the fetch, so "landed" reads the current origin/main; before anything is added.
  const refused=capRefusal(canonical,env);
  if(refused!=='')throw new StopError(refused);
  // Git refuses `-b` for a branch that appeared since the check, before anything here owns one.
  timed('add',()=>{git(canonical,['worktree','add','--quiet','--no-checkout','-b',branch,relative,base]);});
  try{
   timed('checkout',()=>{
    git(tree,['reset','--quiet']);
    let cloned=0;
    if(options.clone&&process.platform==='darwin'){
     try{cloned=cloneTrackedFiles(canonical,tree);}
     catch(error){process.stderr.write(`worktree: clone reuse skipped (${error instanceof Error?error.message:String(error)}); git writes every file\n`);}
    }
    // Git writes every tracked file the clone did not place (and symlinks); it never overwrites a verified clone.
    const missing=[...stagedBlobs(tree).keys()].filter(path=>{try{lstatSync(join(tree,path));return false;}catch{return true;}});
    const written=spawnSync('git',['checkout-index','--stdin','-z'],{cwd:tree,input:missing.map(path=>`${path}\0`).join(''),encoding:'utf8',maxBuffer:64<<20});
    if(written.status!==0)throw new StopError(`git checkout-index: ${written.stderr.trim()}`);
    tryGit(tree,['update-index','-q','--refresh']);
    const stray=git(tree,['status','--porcelain','--untracked-files=no']).trim();
    if(stray!=='')throw new StopError(`${relative} is not clean after checkout:\n${stray.split('\n').slice(0,10).join('\n')}`);
    checkHooks(tree);
    return `${cloned} of ${stagedBlobs(tree).size} tracked files cloned from the canonical checkout`;
   });
  }catch(error){
   // Take back only what this setup made: its worktree, and its branch while it still points at the base.
   tryGit(canonical,['worktree','remove','--force',relative]);
   tryGit(canonical,['update-ref','-d',`refs/heads/${branch}`,base]);
   throw error;
  }
 }finally{unlock();}
 const manifest=join(tree,'package.json');
 const scripts=existsSync(manifest)?/** @type {{scripts?:Record<string,string>}} */(JSON.parse(readFileSync(manifest,'utf8'))).scripts??{}:{};
 const childEnv=Object.fromEntries(Object.entries(env).filter(([key])=>!key.startsWith('GIT_')));
 if(options.install&&existsSync(manifest))timed('install',()=>withStoreUse(env,'worktree install',()=>run(tree,'pnpm',['install','--frozen-lockfile','--offline'],childEnv)));
 if(options.pins&&scripts.pins!==undefined)timed('pins',()=>run(tree,'pnpm',['--silent','pins'],childEnv));
 if(options.herdr&&env.HERDR_ENV==='1'&&env.HERDR_PANE_ID!==undefined&&env.HERDR_PANE_ID!==''){
  const named=spawnSync('herdr',['pane','rename',env.HERDR_PANE_ID,`${basename(canonical)} ${branch}`],{encoding:'utf8'});
  if(named.status!==0)process.stderr.write(`worktree: herdr pane not renamed (${named.error?.message??named.stderr.trim()})\n`);
 }
 // LAND-SIMPLIFY LS2: local readers use main's last measured test seconds; refresh a missing or day-old table in the
 // background (scripts/test-timings.mjs fetch). It never holds up the worktree, and a failure only leaves the defaults.
 if(!env.CI&&env.WS_TIMINGS_FETCH!=='0'&&existsSync(join(tree,'scripts/test-timings.mjs'))){
  try{spawn(process.execPath,['scripts/test-timings.mjs','fetch','--if-stale'],{cwd:tree,env:childEnv,detached:true,stdio:'ignore'}).unref();}
  catch(error){process.stderr.write(`worktree: timings refresh not started (${error instanceof Error?error.message:String(error)})\n`);}
 }
 const total=Number(((performance.now()-began)/1000).toFixed(2));
 const record={slug:options.slug,branch,base,tree,total,steps,finished:new Date().toISOString()};
 mkdirSync(join(tree,'tmp'),{recursive:true});
 writeFileSync(join(tree,'tmp/worktree-setup.json'),`${JSON.stringify(record,null,2)}\n`);
 const lane=/^[a-z][a-z0-9_-]*$/u.test(env.WS_LANE_NAME??'')?String(env.WS_LANE_NAME):'';
 if(lane!==''){
  const file=resolve(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
  try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${new Date().toISOString().slice(11,16)} UTC ${lane} worktree new ${basename(canonical)}/${relative} on ${branch} from ${base.slice(0,10)} in ${total.toFixed(1)} s (${steps.map(row=>`${row.step} ${row.seconds.toFixed(1)}`).join(', ')})\n`);}
  catch(error){process.stderr.write(`worktree receipt unavailable: ${String(error)}\n`);}
 }
 const name=lane===''?'<lane>':lane;
 process.stdout.write(`\nworktree ready in ${total.toFixed(1)} s: ${tree} on ${branch}\n\nLand (J240):\n  cd ${tree}\n  # commit by pathspec as usual; the hooks allow commits here on ${branch}\n  WS_LANE_NAME=${name} node scripts/land.mjs\n  # it pushes ${branch}, waits for its hosted CI (land.config.json workflows), rebases and fast-forwards main;\n  # check its receipt in ~/.cache/wildshard/lane-receipts.log. Force only your own plan/* branch\n  # after a rebase (--force-with-lease), never main.\n`);
 return 0;
}

if(process.argv[1]!==undefined&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const argv=process.argv.slice(2);
 try{
  if(argv[0]==='reap'){
   let options;
   try{options=parseReapArgs(argv.slice(1));}catch(error){throw new StopError(error instanceof Error?error.message:String(error));}
   process.exitCode=reap(canonicalRoot(process.cwd()),options,process.env,line=>{process.stdout.write(`${line}\n`);});
  }
  else process.exitCode=worktreeNew(argv);
 }
 catch(error){
  if(!(error instanceof StopError))throw error;
  process.stderr.write(`worktree STOP ${error.message}\n`);
  process.exitCode=1;
 }
}
