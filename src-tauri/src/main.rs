// #![cfg_attr(
//     all(not(debug_assertions), target_os = "windows"),
//     windows_subsystem = "windows"
// )]

use std::sync::{Arc, Mutex};
use std::process::Command as StdCommand;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{ShellExt, process::{CommandChild, CommandEvent}};

struct BackendProcess(Arc<Mutex<Option<CommandChild>>>);

#[tauri::command]
async fn select_database(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog()
        .file()
        .add_filter("SQLite Database", &["db", "sqlite", "sqlite3"])
        .pick_file(move |file| {
            let path_str = file.map(|f| f.to_string());
            let _ = tx.send(path_str);
        });

    match rx.await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("No file selected".into()),
        Err(_) => Err("Failed to receive file path".into()),
    }
}

#[tauri::command]
async fn select_encrypted_database(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog()
        .file()
        .add_filter("Encrypted WhatsApp Database", &["crypt14", "crypt15", "crypt12", "crypt8"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file| {
            let path_str = file.map(|f| f.to_string());
            let _ = tx.send(path_str);
        });

    match rx.await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("No file selected".into()),
        Err(_) => Err("Failed to receive file path".into()),
    }
}

#[tauri::command]
async fn select_media_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |folder| {
        let path_str = folder.map(|f| f.to_string());
        let _ = tx.send(path_str);
    });

    match rx.await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("No folder selected".into()),
        Err(_) => Err("Failed to receive folder path".into()),
    }
}

#[tauri::command]
async fn select_export_folder(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog().file().pick_folder(move |folder| {
        let path_str = folder.map(|f| f.to_string());
        let _ = tx.send(path_str);
    });

    match rx.await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("No folder selected".into()),
        Err(_) => Err("Failed to receive folder path".into()),
    }
}

#[tauri::command]
async fn select_chat_import(app: tauri::AppHandle) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    app.dialog()
        .file()
        .add_filter("WhatsApp Chat Export", &["wachat", "json"])
        .pick_file(move |file| {
            let path_str = file.map(|f| f.to_string());
            let _ = tx.send(path_str);
        });

    match rx.await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => Err("No file selected".into()),
        Err(_) => Err("Failed to receive file path".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Arc::new(Mutex::new(None))))
        .setup(|app| {
            let backend_process = app.state::<BackendProcess>();

            // Kill any existing process on port 8765 before starting
            #[cfg(target_os = "windows")]
            {
                let _ = StdCommand::new("cmd")
                    .args(["/C", r#"for /f "tokens=5" %a in ('netstat -aon ^| findstr :8765') do taskkill /F /PID %a"#])
                    .output();
                
                // Small delay to ensure port is freed
                std::thread::sleep(std::time::Duration::from_millis(100));
            }

            let sidecar = app
                .shell()
                .sidecar("backend")
                .expect("failed to create backend sidecar");

            let (mut rx, child) = sidecar
                .args(["--port", "8765"])
                .spawn()
                .expect("failed to spawn backend");

            *backend_process.0.lock().unwrap() = Some(child);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[Backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[Backend Error] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            println!("[Backend] Terminated: {:?}", payload);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Step 1: kill the tracked child process
                let backend_process = window.state::<BackendProcess>();
                let mut guard = backend_process.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
                drop(guard);

                // Step 2: force-kill anything still holding port 8765
                #[cfg(target_os = "windows")]
                {
                    let _ = StdCommand::new("cmd")
                        .args(["/C", r#"for /f "tokens=5" %a in ('netstat -aon ^| findstr :8765') do taskkill /F /PID %a 2>nul"#])
                        .creation_flags(0x08000000)
                        .spawn();
                }

                #[cfg(target_os = "macos")]
                {
                    let _ = StdCommand::new("sh")
                        .args(["-c", "lsof -ti:8765 | xargs kill -9 2>/dev/null || true"])
                        .spawn();
                }

                #[cfg(target_os = "linux")]
                {
                    let _ = StdCommand::new("sh")
                        .args(["-c", "fuser -k 8765/tcp 2>/dev/null || true"])
                        .spawn();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            select_database,
            select_encrypted_database,
            select_media_folder,
            select_export_folder,
            select_chat_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
