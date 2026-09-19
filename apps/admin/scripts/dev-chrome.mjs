import { spawn, exec } from "child_process";

const url = "http://localhost:3000";
const next = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: true,
});

let opened = false;

function openChrome() {
  if (opened) return;
  opened = true;
  // Sin caché de disco: el panel madre debe verse al instante tras cada cambio.
  exec(
    `cmd /c start chrome --disk-cache-size=1 --media-cache-size=1 --disable-application-cache ${url}`,
  );
}

const timer = setInterval(() => {
  fetch(url)
    .then((res) => {
      if (res.ok) {
        clearInterval(timer);
        openChrome();
      }
    })
    .catch(() => {});
}, 400);

next.on("exit", (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});
