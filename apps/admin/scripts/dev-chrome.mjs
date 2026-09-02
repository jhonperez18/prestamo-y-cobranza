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
  exec(`cmd /c start chrome ${url}`);
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
