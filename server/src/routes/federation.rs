use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rand::Rng;
use sea_orm::*;
use sea_orm::prelude::Expr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entities::{channel, federated_channel, federation_peer, message};
use crate::models::{FederatedChannel, FederationPeer, Permissions, WsServerMessage};
use crate::routes::auth;
use crate::routes::roles::user_has_permission;
use crate::state::AppState;

// ─── Request / Response ───

#[derive(Debug, Deserialize)]
pub struct AddPeerRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Serialize)]
pub struct AddPeerResponse {
    pub peer: FederationPeer,
    /// The shared secret to give to the remote server
    pub shared_secret: String,
}

#[derive(Debug, Deserialize)]
pub struct AcceptPeerRequest {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub shared_secret: String,
}

#[derive(Debug, Deserialize)]
pub struct LinkChannelRequest {
    pub peer_id: String,
    pub local_channel_id: String,
    pub remote_channel_id: String,
}

#[derive(Debug, Deserialize)]
pub struct FederatedMessageRequest {
    pub channel_id: String,
    pub user_name: String,
    pub content: String,
    pub server_name: String,
}

#[derive(Debug, Serialize)]
pub struct FederationStatus {
    pub peers: Vec<FederationPeer>,
    pub linked_channels: Vec<FederatedChannel>,
}

/// Generate a random shared secret for federation handshake
fn generate_shared_secret() -> String {
    let secret: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    format!("fed_{}", secret)
}

// ─── Routes ───

/// GET /api/federation — get federation status (peers + linked channels)
pub async fn get_federation_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<FederationStatus>, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    let mut peers: Vec<FederationPeer> = federation_peer::Entity::find()
        .order_by_desc(federation_peer::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Mask shared secrets
    for p in &mut peers {
        p.shared_secret = String::new();
    }

    let linked_channels: Vec<FederatedChannel> = federated_channel::Entity::find()
        .order_by_desc(federated_channel::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(Json(FederationStatus {
        peers,
        linked_channels,
    }))
}

/// POST /api/federation/peers — initiate federation with a remote server
pub async fn add_peer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AddPeerRequest>,
) -> Result<(StatusCode, Json<AddPeerResponse>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    let name = req.name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Name must be 1-64 chars".into()));
    }

    // Check duplicate
    let exists = federation_peer::Entity::find()
        .filter(federation_peer::Column::Host.eq(&req.host))
        .filter(federation_peer::Column::Port.eq(req.port as i64))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if exists.is_some() {
        return Err((StatusCode::CONFLICT, "Peer already exists".into()));
    }

    let peer_id = Uuid::new_v4().to_string();
    let shared_secret = generate_shared_secret();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_peer = federation_peer::ActiveModel {
        id: Set(peer_id.clone()),
        name: Set(name.clone()),
        host: Set(req.host.clone()),
        port: Set(req.port as i64),
        shared_secret: Set(shared_secret.clone()),
        status: Set("pending".to_string()),
        direction: Set("outgoing".to_string()),
        created_at: Set(now.clone()),
        last_seen: Set(None),
    };

    federation_peer::Entity::insert(new_peer)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let peer = FederationPeer {
        id: peer_id,
        name,
        host: req.host,
        port: req.port as i64,
        shared_secret: String::new(), // don't expose in response object
        status: "pending".to_string(),
        direction: "outgoing".to_string(),
        created_at: now,
        last_seen: None,
    };

    Ok((StatusCode::CREATED, Json(AddPeerResponse {
        peer,
        shared_secret,
    })))
}

/// POST /api/federation/accept — accept an incoming federation request
pub async fn accept_peer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AcceptPeerRequest>,
) -> Result<(StatusCode, Json<FederationPeer>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    let peer_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_peer = federation_peer::ActiveModel {
        id: Set(peer_id.clone()),
        name: Set(req.name.clone()),
        host: Set(req.host.clone()),
        port: Set(req.port as i64),
        shared_secret: Set(req.shared_secret.clone()),
        status: Set("active".to_string()),
        direction: Set("incoming".to_string()),
        created_at: Set(now.clone()),
        last_seen: Set(None),
    };

    federation_peer::Entity::insert(new_peer)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let peer = FederationPeer {
        id: peer_id,
        name: req.name,
        host: req.host,
        port: req.port as i64,
        shared_secret: String::new(),
        status: "active".to_string(),
        direction: "incoming".to_string(),
        created_at: now,
        last_seen: None,
    };

    Ok((StatusCode::CREATED, Json(peer)))
}

/// DELETE /api/federation/peers/:peer_id — remove a federation peer
pub async fn remove_peer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(peer_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    // Delete linked channels first
    federated_channel::Entity::delete_many()
        .filter(federated_channel::Column::PeerId.eq(&peer_id))
        .exec(&state.db)
        .await
        .ok();

    federation_peer::Entity::delete_by_id(&peer_id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/federation/channels — link a local channel to a remote channel
pub async fn link_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LinkChannelRequest>,
) -> Result<(StatusCode, Json<FederatedChannel>), (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    // Verify peer exists
    let peer_exists = federation_peer::Entity::find_by_id(&req.peer_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if peer_exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Federation peer not found".into()));
    }

    // Verify local channel exists
    let chan_exists = channel::Entity::find_by_id(&req.local_channel_id)
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    if chan_exists.is_none() {
        return Err((StatusCode::NOT_FOUND, "Local channel not found".into()));
    }

    let link_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    let new_link = federated_channel::ActiveModel {
        id: Set(link_id.clone()),
        local_channel_id: Set(req.local_channel_id.clone()),
        peer_id: Set(req.peer_id.clone()),
        remote_channel_id: Set(req.remote_channel_id.clone()),
        created_at: Set(now.clone()),
    };

    federated_channel::Entity::insert(new_link)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    let link = FederatedChannel {
        id: link_id,
        local_channel_id: req.local_channel_id,
        peer_id: req.peer_id,
        remote_channel_id: req.remote_channel_id,
        created_at: now,
    };

    Ok((StatusCode::CREATED, Json(link)))
}

/// DELETE /api/federation/channels/:link_id — unlink a federated channel
pub async fn unlink_channel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(link_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    federated_channel::Entity::delete_by_id(&link_id)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/federation/message — receive a message from a federated server
/// Authenticated via shared_secret in the Authorization header: `Federation <secret>`
pub async fn receive_federated_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FederatedMessageRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Authenticate via federation shared secret
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, "Missing Authorization header".into()))?;

    let secret = auth_header.strip_prefix("Federation ").ok_or((
        StatusCode::UNAUTHORIZED,
        "Use: Authorization: Federation <shared_secret>".into(),
    ))?;

    // Validate shared secret and find peer
    let peer = federation_peer::Entity::find()
        .filter(federation_peer::Column::SharedSecret.eq(secret))
        .filter(federation_peer::Column::Status.eq("active"))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::UNAUTHORIZED, "Invalid or inactive federation secret".into()))?;

    // Find local channel linked to the remote channel_id from this peer
    let link = federated_channel::Entity::find()
        .filter(federated_channel::Column::PeerId.eq(&peer.id))
        .filter(federated_channel::Column::RemoteChannelId.eq(&req.channel_id))
        .one(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "No linked channel for this peer/channel".into()))?;

    // Insert message into local channel
    let msg_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let federated_user_name = format!("{} [{}]", req.user_name, req.server_name);

    let new_msg = message::ActiveModel {
        id: Set(msg_id.clone()),
        channel_id: Set(link.local_channel_id.clone()),
        user_id: Set(format!("fed:{}", peer.id)),
        user_name: Set(federated_user_name.clone()),
        content: Set(req.content.clone()),
        created_at: Set(now.clone()),
        ..Default::default()
    };

    message::Entity::insert(new_msg)
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    // Update last_seen for the peer
    federation_peer::Entity::update_many()
        .col_expr(federation_peer::Column::LastSeen, Expr::value(now.clone()))
        .filter(federation_peer::Column::Id.eq(&peer.id))
        .exec(&state.db)
        .await
        .ok();

    // Broadcast to local WS subscribers
    let broadcast_msg = WsServerMessage::NewMessage {
        id: msg_id.clone(),
        channel_id: link.local_channel_id.clone(),
        user_id: format!("fed:{}", peer.id),
        user_name: federated_user_name,
        avatar_url: None,
        content: req.content,
        created_at: now,
        is_bot: false,
    };

    let tx = state.get_channel_tx(&link.local_channel_id);
    let _ = tx.send(broadcast_msg);

    Ok(Json(serde_json::json!({ "id": msg_id })))
}

/// POST /api/federation/peers/:peer_id/activate — activate a pending peer
pub async fn activate_peer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(peer_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = auth::extract_claims(&state.jwt_secret, &headers)?;
    if !user_has_permission(&state, &claims.sub, Permissions::MANAGE_SERVER)
        .await
        .map_err(|e| (e, "Permission check failed".to_string()))?
    {
        return Err((StatusCode::FORBIDDEN, "MANAGE_SERVER required".into()));
    }

    federation_peer::Entity::update_many()
        .col_expr(federation_peer::Column::Status, Expr::value("active"))
        .filter(federation_peer::Column::Id.eq(&peer_id))
        .exec(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}")))?;

    Ok(StatusCode::OK)
}
