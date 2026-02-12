use hickory_resolver::Resolver;
use hickory_resolver::config::*;
use serde::Serialize;

#[derive(Serialize)]
pub struct SrvResult {
  host: String,
  port: u16,
}

#[tauri::command]
fn resolve_srv(domain: String) -> Result<Option<SrvResult>, String> {
  let resolver = Resolver::new(ResolverConfig::default(), ResolverOpts::default())
    .map_err(|e| e.to_string())?;
  
  let query = format!("_sivycord._tcp.{}", domain);
  match resolver.srv_lookup(query) {
    Ok(lookup) => {
      if let Some(srv) = lookup.iter().next() {
        let host = srv.target().to_string().trim_end_matches('.').to_string();
        return Ok(Some(SrvResult {
          host,
          port: srv.port(),
        }));
      }
      Ok(None)
    }
    Err(_) => Ok(None),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![resolve_srv])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
