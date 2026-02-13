use crate::state::SrvResult;
use hickory_resolver::config::*;
use hickory_resolver::Resolver;

#[tauri::command]
pub async fn resolve_srv(domain: String) -> Result<Option<SrvResult>, String> {
    let resolver = Resolver::new(ResolverConfig::default(), ResolverOpts::default())
        .map_err(|e| e.to_string())?;

    let query = format!("_sivyspeak._tcp.{}", domain);
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
