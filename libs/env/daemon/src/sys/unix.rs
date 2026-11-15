use super::{OpenMode, ShellConfig, path_exists};
use crate::errors::Failure;
use serde_json::{Map, Value};
use std::ffi::{CString, OsStr};
use std::fs::{File, Metadata, OpenOptions};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileExt, MetadataExt, OpenOptionsExt};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

pub fn os_error_name(error: &io::Error) -> &'static str {
    let Some(errno) = error.raw_os_error() else {
        return "UNKNOWN";
    };
    match errno {
        libc::EPERM => "EPERM",
        libc::ENOENT => "ENOENT",
        libc::EIO => "EIO",
        libc::EBADF => "EBADF",
        libc::EAGAIN => "EAGAIN",
        libc::ENOMEM => "ENOMEM",
        libc::EACCES => "EACCES",
        libc::EBUSY => "EBUSY",
        libc::EEXIST => "EEXIST",
        libc::EXDEV => "EXDEV",
        libc::ENOTDIR => "ENOTDIR",
        libc::EISDIR => "EISDIR",
        libc::EINVAL => "EINVAL",
        libc::ENFILE => "ENFILE",
        libc::EMFILE => "EMFILE",
        libc::ETXTBSY => "ETXTBSY",
        libc::EFBIG => "EFBIG",
        libc::ENOSPC => "ENOSPC",
        libc::EROFS => "EROFS",
        libc::EMLINK => "EMLINK",
        libc::ENAMETOOLONG => "ENAMETOOLONG",
        libc::ENOTEMPTY => "ENOTEMPTY",
        libc::ELOOP => "ELOOP",
        libc::ENOSYS => "ENOSYS",
        libc::ENOTSUP => "ENOTSUP",
        _ => "UNKNOWN",
    }
}

pub const PATH_SEPARATOR: &str = "/";

pub fn read_at(file: &File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    file.read_at(buffer, offset)
}

pub fn mtime(metadata: &Metadata) -> (i64, i64) {
    (metadata.mtime(), metadata.mtime_nsec())
}

pub fn identity(metadata: &Metadata) -> (u64, u64) {
    (metadata.dev(), metadata.ino())
}

pub fn tmpdir() -> String {
    let configured = ["TMPDIR", "TMP", "TEMP"]
        .iter()
        .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()));
    let mut path = configured.unwrap_or_else(|| {
        if cfg!(target_os = "android") {
            format!(
                "{}/tmp",
                std::env::var("PREFIX")
                    .unwrap_or_else(|_| "/data/data/com.termux/files/usr".into())
            )
        } else {
            "/tmp".into()
        }
    });
    if path.len() > 1 && path.ends_with('/') {
        path.pop();
    }
    path
}

pub fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

pub fn mkdtemp(prefix: &str) -> io::Result<String> {
    let mut template = prefix.as_bytes().to_vec();
    template.extend_from_slice(b"XXXXXX");
    let template =
        CString::new(template).map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    let mut buffer = template.into_bytes_with_nul();
    let created = unsafe { libc::mkdtemp(buffer.as_mut_ptr().cast()) };
    if created.is_null() {
        return Err(io::Error::last_os_error());
    }
    buffer.pop();
    Ok(OsStr::from_bytes(&buffer).to_string_lossy().into_owned())
}

pub fn open_reader(path: &str, no_follow: bool) -> Result<File, Failure> {
    let mut flags = libc::O_NONBLOCK;
    if no_follow {
        flags |= libc::O_NOFOLLOW;
    }
    OpenOptions::new()
        .read(true)
        .custom_flags(flags)
        .open(path)
        .map_err(|error| {
            if no_follow && matches!(error.raw_os_error(), Some(libc::ELOOP) | Some(libc::EMLINK)) {
                Failure::new("SYMLINK", "Refusing to follow a symbolic link").path(path)
            } else {
                Failure::io(&error, "open", path)
            }
        })
}

pub fn open(path: &str, mode: OpenMode) -> io::Result<File> {
    let mut options = OpenOptions::new();
    match mode {
        OpenMode::Read => options.read(true),
        OpenMode::Write => options.write(true).create(true).truncate(true),
        OpenMode::Append => options.append(true).create(true),
        OpenMode::ReadWrite => options.read(true).write(true),
    };
    options.open(path)
}

pub fn realpath(path: &str) -> io::Result<String> {
    std::fs::canonicalize(path).map(|resolved| resolved.to_string_lossy().into_owned())
}

pub fn rename(from: &str, to: &str) -> io::Result<()> {
    std::fs::rename(from, to)
}

pub fn remove_file(path: &str) -> io::Result<()> {
    std::fs::remove_file(path)
}

pub trait Pipe: io::Read + std::os::fd::AsRawFd {}
impl<T: io::Read + std::os::fd::AsRawFd> Pipe for T {}

pub fn read_pipe(mut pipe: impl Pipe, stop: &AtomicBool, mut on_data: impl FnMut(&[u8]) -> bool) {
    let fd = pipe.as_raw_fd();
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
    let mut buffer = vec![0u8; 64 * 1024];
    while !stop.load(Ordering::SeqCst) {
        let mut poll = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut poll, 1, 100) };
        if ready == 0
            || (ready < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted)
        {
            continue;
        }
        if ready < 0 {
            return;
        }
        match pipe.read(&mut buffer) {
            Ok(0) => return,
            Ok(read) => {
                if !on_data(&buffer[..read]) {
                    return;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) => {}
            Err(_) => return,
        }
    }
}

pub fn interrupt_reader(_reader: &std::thread::JoinHandle<()>) {}

pub fn resolve_program(
    program: &str,
    _cwd: &str,
    _env: &Map<String, Value>,
) -> Result<String, Failure> {
    Ok(program.to_string())
}

fn which_bash() -> Option<String> {
    let output = Command::new("which")
        .arg("bash")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .to_string();
    path_exists(&first).then_some(first)
}

pub fn shell_config(shell_path: Option<&str>) -> Result<ShellConfig, Failure> {
    let shell = |program: &str| ShellConfig {
        program: program.into(),
        args: vec!["-c".into()],
        command_on_stdin: false,
    };
    if let Some(configured) = shell_path {
        if path_exists(configured) {
            return Ok(shell(configured));
        }
        return Err(Failure::new(
            "shell_unavailable",
            format!("Custom shell path not found: {configured}"),
        ));
    }
    if path_exists("/bin/bash") {
        return Ok(shell("/bin/bash"));
    }
    Ok(shell(&which_bash().unwrap_or_else(|| "sh".into())))
}

pub fn configure(
    command: &mut Command,
    args: &[String],
    env: &Map<String, Value>,
    inherit_env: bool,
) {
    command.args(args);
    if !inherit_env {
        command.env_clear();
    }
    for (key, value) in env {
        if let Some(value) = value.as_str() {
            command.env(key, value);
        }
    }
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            for signal in 1..32 {
                if signal != libc::SIGKILL && signal != libc::SIGSTOP {
                    libc::signal(signal, libc::SIG_DFL);
                }
            }
            let mut mask: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut mask);
            libc::sigprocmask(libc::SIG_SETMASK, &mask, std::ptr::null_mut());
            Ok(())
        });
    }
}

pub fn after_spawn(_child: &Child) {}

pub fn kill_tree(pid: u32) {
    let pid = pid as i32;
    unsafe {
        if libc::kill(-pid, libc::SIGKILL) != 0 {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

pub fn exit_code(status: ExitStatus) -> i64 {
    i64::from(
        status
            .code()
            .unwrap_or_else(|| 128 + status.signal().unwrap_or(0)),
    )
}

pub fn raw_name(name: &OsStr) -> Option<Vec<u8>> {
    Some(name.as_bytes().to_vec())
}

pub fn drive_cwds() -> Map<String, Value> {
    Map::new()
}

pub fn read_dir(path: &str) -> io::Result<std::fs::ReadDir> {
    std::fs::read_dir(path)
}

pub fn path_identity(_path: &str, metadata: &Metadata, _follow: bool) -> (u64, u64) {
    identity(metadata)
}
