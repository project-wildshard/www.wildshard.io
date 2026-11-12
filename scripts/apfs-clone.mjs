// DEV-SPEED DS12: real APFS clones from Node. Node's `COPYFILE_FICLONE` makes a full copy on macOS (measured: a
// clone's ATTR_CMNEXT_PRIVATESIZE equals its size, so every "clone" cost its bytes again) and `cpSync` ignores the
// flag, so a clone here is fclonefileat(2), called through python3's ctypes: one process for every pair.
//
// Each source is opened without following a final symlink and must be a regular file or a directory by its open
// descriptor, so a path swapped for a link between any check and the clone is refused, never followed. A directory is
// cloned whole in one call; links inside it stay links, so a caller that needs regular files walks the result. The
// target must not exist. A clone shares every block with its source until either side writes, so it costs no disk;
// a caller that must trust the bytes hashes them afterwards (pins-reuse.mjs does).
//
// Off macOS, or when the filesystem refuses clones (another volume, no clone support), each pair is copied instead,
// with the same refusal of a linked source.
import {spawnSync} from 'node:child_process';
import {closeSync,constants,cpSync,fstatSync,lstatSync,openSync,readFileSync,writeFileSync} from 'node:fs';

const CLONE=`import ctypes, os, stat, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.fclonefileat.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
AT_FDCWD, CLONE_NOOWNERCOPY = -2, 2
parts = sys.stdin.buffer.read().split(b'\\0')[:-1]
for source, target in zip(parts[0::2], parts[1::2]):
    try:
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        sys.exit(f'{source.decode()}: {error.strerror}')
    try:
        mode = os.fstat(fd).st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            sys.exit(f'{source.decode()}: not a regular file or directory')
        if libc.fclonefileat(fd, AT_FDCWD, target, CLONE_NOOWNERCOPY) != 0:
            sys.exit(f'{target.decode()}: {os.strerror(ctypes.get_errno())}')
    finally:
        os.close(fd)`;

/** Copy one pair, refusing a linked source the same way the clone does. @param {string} source @param {string} target */
function copyPair(source,target){
 const fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);
  if(stat.isFile()){writeFileSync(target,readFileSync(fd),{flag:'wx',mode:stat.mode&0o777});return;}
  if(!stat.isDirectory())throw new Error(`${source}: not a regular file or directory`);
 }finally{closeSync(fd);}
 cpSync(source,target,{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true});
 if(!lstatSync(target).isDirectory())throw new Error(`${target}: copy is not a directory`);
}

/**
 * Clone each `[source, target]` pair. Returns `clone` when every pair is an APFS clone, `copy` when some were copied.
 * Throws when a source is a link, missing or neither a file nor a directory, or a target exists; a pair cloned before
 * the failure stays.
 * @param {readonly (readonly [string,string])[]} pairs @param {{platform?:string}} [options]
 * @returns {'clone'|'copy'|'none'}
 */
export function clonePaths(pairs,{platform=process.platform}={}){
 if(pairs.length===0)return 'none';
 let rest=pairs;
 if(platform==='darwin'){
  const result=spawnSync('python3',['-I','-c',CLONE],{input:`${pairs.flat().join('\0')}\0`,encoding:'utf8',maxBuffer:64<<20});
  if(result.status===0)return 'clone';
  const reason=result.error?.message??result.stderr.trim();
  // Only a refusal the filesystem gives (no clone support, another volume) falls back to copies; anything else stops.
  if(!/Operation not supported|Cross-device link/u.test(reason))throw new Error(`clonefile: ${reason}`);
  rest=pairs.filter(([,target])=>{try{lstatSync(target);return false;}catch{return true;}});
 }
 for(const [source,target] of rest)copyPair(source,target);
 return 'copy';
}
