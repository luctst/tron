#!/usr/bin/env python3
"""Drive `tron smoke` through a pseudo-terminal and assert on the rendered frames. Stdlib only."""
import fcntl, os, pty, re, select, struct, subprocess, sys, termios, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROWS, COLS = 30, 100
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
LEAVE = b'\x1b[?1049l'
failed = 0
last_frame = ''
pid = fd = None
raw = bytearray()


def ok(label, cond):
    global failed
    print('ok  ' if cond else 'FAIL', label, flush=True)
    if not cond:
        failed += 1
        print('---- last stripped frame ----\n' + '\n'.join(last_frame.splitlines()[-32:]) + '\n----', flush=True)


def spawn():
    """Start one app instance in a 100x30 pty; sized on the slave before exec and on the master after."""
    global pid, fd, raw
    env = dict(os.environ, TRON_SMOKE_PW='postgres', TERM='xterm-256color')
    winsz = struct.pack('HHHH', ROWS, COLS, 0, 0)
    raw = bytearray()
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(0, termios.TIOCSWINSZ, winsz)
        os.chdir(ROOT)
        os.execvpe('node', ['node', 'dist/src/cli.js', 'smoke'], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsz)


def drain(seconds=2.0):
    """Read for `seconds`; return the ANSI-stripped text received in that window."""
    global last_frame
    chunk = bytearray()
    end = time.time() + seconds
    while True:
        left = end - time.time()
        if left <= 0:
            break
        r, _, _ = select.select([fd], [], [], min(left, 0.1))
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:  # EIO: child closed the pty
                break
            if not data:
                break
            chunk += data
    raw.extend(chunk)
    last_frame = ANSI.sub('', chunk.decode('utf8', 'replace'))
    return last_frame


def send(keys, per_char=0.03):
    """Type keys one at a time: Ink hands a multi-char chunk to useInput as a single event. Let output
    settle before every control key so Esc/Tab/Ctrl-U never coalesce with the text before them."""
    for ch in keys:
        if ch in '\r\x1b\t\x15\x03':
            drain(0.4)
        os.write(fd, ch.encode())
        time.sleep(per_char)


def step(label, keys, *expect, wait=2.0):
    send(keys)
    text = drain(wait)
    for e in expect:
        ok(f'{label}: {e!r} shown', e in text)
    return text


def wait_exit(label, key):
    """Send `key`, wait up to 5 s for the child to exit; check exit code and the alternate-screen exit."""
    send(key)
    end = time.time() + 5
    status = None
    while time.time() < end:
        drain(0.2)
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            break
        status = None
    drain(0.5)
    if status is None:
        os.kill(pid, 9)
        os.waitpid(pid, 0)
        ok(f'{label}: exited within 5s', False)
    else:
        code = os.waitstatus_to_exitcode(status)
        ok(f'{label}: exit code 0 (got {code})', code == 0)
    # Ink's restore-cursor exit hook (signal-exit, alwaysLast) writes a cursor-show to stderr after our
    # `\x1b[?1049l`, so "ends with" is wrong; nothing but cursor-visibility may follow.
    idx = bytes(raw).rfind(LEAVE)
    after = bytes(raw)[idx + len(LEAVE):] if idx >= 0 else b'<missing>'
    ok(f'{label}: leaves the alternate screen, only cursor-show follows (after={after!r})',
       idx >= 0 and re.fullmatch(rb'(\x1b\[\?25[hl])*', after) is not None)
    whole = ANSI.sub('', bytes(raw).decode('utf8', 'replace'))
    neg = re.findall(r'(?:running… |· )-\d+m?s', whole)
    ok(f'{label}: no negative elapsed counter anywhere ({neg[:3]})', not neg)
    os.close(fd)


def db_names():
    return subprocess.run(
        ['docker', 'exec', 'tron-pg', 'psql', '-U', 'postgres', '-tAc', "select string_agg(name, ',' order by id) from smoke_users"],
        capture_output=True, text=True).stdout.strip()


# ---- instance 1: browse, read, error, write + n, quit with q ----
spawn()
text = drain(3.0)
for e in ('smoke_orders', 'smoke_users', '2 tables'):
    ok(f'startup: {e!r} shown', e in text)

send('j'); drain(0.5)
step('open smoke_orders', '\r', '0 rows')
step('structure', 's', 'pk id', 'public.smoke_users(id)')
step('structure off', 's', '0 rows')

send('/\x15'); drain(0.5)  # focus the search bar and clear the previous query
step('truncated read', 'select generate_series(1,1000) as n\r', '500+ (truncated)')

send('/\x15'); drain(0.5)
step('bad table', 'select * from nowhere\r', 'does not exist')
send('\x1b'); drain(0.5)

send('/\x15'); drain(0.5)
step('pending write', "update smoke_users set name = 'x'\r", 'UPDATE affected 2 rows', 'commit?')
step('rollback', 'n', 'rolled back')
# focus returns to the grid after a write settles, so q quits without an Esc first
wait_exit('quit q', 'q')
ok(f'db: smoke_users untouched after n ({db_names()})', db_names() == 'seed,kept')

# ---- instance 2: pending write, Ctrl-C rolls back and quits ----
spawn()
text = drain(3.0)
ok("startup 2: '2 tables' shown", '2 tables' in text)
send('/\x15'); drain(0.5)
step('pending write 2', "update smoke_users set name = 'x'\r", 'commit?')
wait_exit('quit ctrl-c', '\x03')
ok(f'db: smoke_users untouched after Ctrl-C ({db_names()})', db_names() == 'seed,kept')

print(f'\n{"FAILED" if failed else "all ok"} ({failed} failures)')
sys.exit(1 if failed else 0)
