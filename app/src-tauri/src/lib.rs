use hickory_resolver::Resolver;
use hickory_resolver::config::*;
use serde::Serialize;

#[derive(Serialize)]
pub struct SrvResult {
  host: String,
  port: u16,
}

#[tauri::command]
async fn get_node_id(state: tauri::State<'_, IrohState>) -> Result<String, String> {
  Ok(state.node.node_id().to_string())
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

use iroh::node::Node;
use iroh::endpoint::SecretKey;

pub struct IrohState {
  pub node: Node,
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

      // Initialize Iroh Node with Persistent Secret Key
      let rt = tokio::runtime::Runtime::new().unwrap();
      let node = rt.block_on(async {
        let entry = keyring::Entry::new("sivyspeak", "default-identity").unwrap();
        let secret_key = match entry.get_password() {
            Ok(pw) => {
                let bytes = hex::decode(pw).expect("invalid secret key in keychain");
                SecretKey::from_bytes(&bytes.try_into().expect("invalid key length"))
            }
            Err(_) => {
                let sk = SecretKey::generate();
                let hex_sk = hex::encode(sk.to_bytes());
                entry.set_password(&hex_sk).expect("failed to save secret key to keychain");
                sk
            }
        };

        Node::memory()
          .secret_key(secret_key)
          .spawn()
          .await
          .unwrap()
      });

      app.manage(IrohState { node });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![resolve_srv, get_node_id])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
