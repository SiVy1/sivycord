use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use sea_orm::*;
use serde::Deserialize;
use std::collections::HashSet;
use uuid::Uuid;

use crate::{entities::{bot, federated_channel, federation_peer, message, server, user}, routes::roles::user_has_permission};
use crate::models::{Bot, RepliedMessage, WsClientMessage, WsServerMessage};
use crate::routes::auth;
use crate::state::AppState;
use crate::models::Permissions;

const MAX_MESSAGE_LENGTH: usize = 2000;
const MAX_FIELD_LENGTH: usize = 256;
const MAX_SDP_LENGTH: usize = 65536;
const MAX_SUBSCRIPTIONS: usize = 50;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    pub token: Option<String>,
    pub server_id: Option<String>,
}

/// Authenticated identity for a WebSocket connection
enum WsIdentity {
    User(auth::Claims),
    Bot(Bot),
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
) -> impl IntoResponse {
    // Try to authenticate: first as bot token, then as JWT
    let identity = if let Some(ref t) = query.token {
        if t.starts_with("bot.") {
            // Bot token auth
            let bot_row = bot::Entity::find()
                .filter(bot::Column::Token.eq(t.as_str()))
                .one(&state.db)
                .await
                .ok()
                .flatten();
            bot_row.map(WsIdentity::Bot)
        } else {
            // JWT user auth
            auth::decode_jwt(&state.jwt_secret, t)
                .ok()
                .map(WsIdentity::User)
        }
    } else {
        None
    };

    let server_id = query.server_id.unwrap_or_else(|| "default".to_string());

    ws.on_upgrade(move |socket| handle_socket(socket, state, identity, server_id))
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    identity: Option<WsIdentity>,
    _server_id: String,
) {
    state.inc_online();

    let (user_id, user_name, is_bot_connection) = match &identity {
        Some(WsIdentity::User(claims)) => (claims.sub.clone(), claims.display_name.clone(), false),
        Some(WsIdentity::Bot(bot)) => (bot.id.clone(), bot.name.clone(), true),
        None => (Uuid::new_v4().to_string(), "Guest".to_string(), false),
    };
    let is_authenticated = identity.is_some();

    // Track online presence
    state.user_online(&user_id).await;

    let (mut sender, mut receiver) = socket.split();
    let mut subscribed_channels: HashSet<String> = HashSet::new();
    let mut voice_user_id: Option<String> = None;

    let (client_tx, mut client_rx) = tokio::sync::mpsc::channel::<WsServerMessage>(256);

    // Send identity to client
    let _ = client_tx.send(WsServerMessage::Identity { user_id: user_id.clone() }).await;

    // Send initial voice state sync
    let voice_states = state.get_all_voice_members();
    let _ = client_tx.send(WsServerMessage::VoiceStateSync { voice_states }).await;

    // Subscribe to global broadcasts (voice presence, etc.)
    let mut global_rx = state.global_tx.subscribe();
    let global_client_tx = client_tx.clone();
    tokio::spawn(async move {
        while let Ok(msg) = global_rx.recv().await {
            if global_client_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    let send_task = tokio::spawn(async move {
        while let Some(msg) = client_rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to serialize WS message: {e}");
                }
            }
        }
    });

    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                if text.len() > MAX_SDP_LENGTH + 1024 {
                    let _ = client_tx
                        .send(WsServerMessage::Error {
                            message: "Message too large".to_string(),
                        })
                        .await;
                    continue;
                }

                let parsed: Result<WsClientMessage, _> = serde_json::from_str(&text);
                match parsed {
                    Ok(WsClientMessage::JoinChannel { channel_id }) => {
                        if channel_id.is_empty() || channel_id.len() > MAX_FIELD_LENGTH {
                            continue;
                        }
                        if subscribed_channels.len() >= MAX_SUBSCRIPTIONS {
                            continue;
                        }
                        if subscribed_channels.insert(channel_id.clone()) {
                            let tx = state.get_channel_tx(&channel_id);
                            let mut rx = tx.subscribe();
                            let client_tx = client_tx.clone();
                            let cid = channel_id.clone();
                            let uid = user_id.clone();

                            tokio::spawn(async move {
                                while let Ok(msg) = rx.recv().await {
                                    let should_send = match &msg {
                                        WsServerMessage::NewMessage { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::UserJoined { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::UserLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoicePeerJoined { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoicePeerLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceMembers { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceTalking { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceStatusUpdate { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceOffer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::VoiceAnswer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::IceCandidate { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::TypingStart { channel_id, user_id, .. } => channel_id == &cid && user_id != &uid,
                                        _ => true,
                                    };
                                    if should_send {
                                        if client_tx.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            });
                        }
                    }
                    Ok(WsClientMessage::LeaveChannel { channel_id }) => {
                        subscribed_channels.remove(&channel_id);
                    }
                    Ok(WsClientMessage::SendMessage {
                        channel_id,
                        content,
                        reply_to,
                        ..
                    }) => {
                        // REQUIRE AUTH for sending messages
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required to send messages".to_string(),
                            }).await;
                            continue;
                        }

                        let content = content.trim().to_string();
                        if content.is_empty() || content.len() > MAX_MESSAGE_LENGTH {
                            continue;
                        }
                        if channel_id.is_empty() {
                            continue;
                        }
                        //check if timeout has expired for user and remove from set if so
                        if state.is_user_timed_out(&user_id).await {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "You are currently timed out and cannot send messages".to_string(),
                            }).await;
                            continue;
                        }

                        let msg_id = Uuid::new_v4().to_string();
                        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

                        let new_msg = message::ActiveModel {
                            id: Set(msg_id.clone()),
                            channel_id: Set(channel_id.clone()),
                            user_id: Set(user_id.clone()),
                            user_name: Set(user_name.clone()),
                            content: Set(content.clone()),
                            created_at: Set(now.clone()),
                            reply_to: Set(reply_to.clone()),
                            ..Default::default()
                        };

                        if let Err(e) = message::Entity::insert(new_msg)
                            .exec(&state.db)
                            .await {
                            tracing::error!("Failed to save message: {e}");
                            continue;
                        }

                        let avatar_url: Option<String> = if is_bot_connection {
                            // For bots, get avatar from bots table
                            bot::Entity::find_by_id(&user_id)
                                .one(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .and_then(|b| b.avatar_url)
                        } else {
                            // For users, get avatar from users table
                            user::Entity::find_by_id(&user_id)
                                .one(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .and_then(|u| u.avatar_url)
                        };

                        // Fetch replied message data if reply_to is set
                        let replied_message = if let Some(ref reply_id) = reply_to {
                            message::Entity::find_by_id(reply_id)
                                .one(&state.db)
                                .await
                                .ok()
                                .flatten()
                                .map(|m| {
                                    let truncated = if m.content.len() > 100 {
                                        format!("{}…", &m.content[..100])
                                    } else {
                                        m.content.clone()
                                    };
                                    RepliedMessage {
                                        id: m.id,
                                        content: truncated,
                                        user_name: m.user_name,
                                    }
                                })
                        } else {
                            None
                        };

                        let broadcast_msg = WsServerMessage::NewMessage {
                            id: msg_id,
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                            avatar_url,
                            content: content.clone(),
                            created_at: now,
                            is_bot: is_bot_connection,
                            reply_to,
                            replied_message,
                        };

                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(broadcast_msg);

                        // Federation: forward message to linked remote channels
                        let fed_state = state.clone();
                        let fed_channel_id = channel_id.clone();
                        let fed_user_name = user_name.clone();
                        let fed_content = content;
                        tokio::spawn(async move {
                            // Find federated channel links with active peers
                            let links = federated_channel::Entity::find()
                                .filter(federated_channel::Column::LocalChannelId.eq(&fed_channel_id))
                                .find_also_related(federation_peer::Entity)
                                .all(&fed_state.db)
                                .await
                                .unwrap_or_default();

                            for (fc, peer_opt) in links {
                                let Some(peer) = peer_opt else { continue };
                                if peer.status != "active" { continue; }

                                let server_name = server::Entity::find_by_id("default")
                                    .one(&fed_state.db)
                                    .await
                                    .ok()
                                    .flatten()
                                    .map(|s| s.name)
                                    .unwrap_or_else(|| "Unknown Server".to_string());

                                let scheme = if peer.port == 443 { "https" } else { "http" };
                                let url = format!("{}://{}:{}/api/federation/message", scheme, peer.host, peer.port);
                                let client = reqwest::Client::builder()
                                    .timeout(std::time::Duration::from_secs(10))
                                    .build()
                                    .unwrap_or_else(|_| reqwest::Client::new());
                                let _ = client.post(&url)
                                    .header("Authorization", format!("Federation {}", peer.shared_secret))
                                    .json(&serde_json::json!({
                                        "channel_id": fc.remote_channel_id,
                                        "user_name": fed_user_name,
                                        "content": fed_content,
                                        "server_name": server_name,
                                    }))
                                    .send()
                                    .await;
                            }
                        });
                    }
                    Ok(WsClientMessage::TimeoutUser { user_id, duration_seconds, reason }) => {
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required to timeout users".to_string(),
                            }).await;
                            continue;
                        }
                        if duration_seconds <= 0 || duration_seconds > 60 * 60 * 24 * 7 {
                            continue; // Limit timeout duration to 7 days
                        }

                        // Check permission
                        if !user_has_permission(&state, &user_id, Permissions::MODERATE_MEMBERS).await.unwrap_or(false) {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Insufficient permissions to timeout users".to_string(),
                            }).await;
                            continue;
                        }

                        // Apply timeout
                        state.timeout_user(&user_id, duration_seconds).await;

                        // Optionally, broadcast timeout event to channels the user is in
                        let _ = state.global_tx.send(WsServerMessage::UserTimedOut {
                            user_id: user_id.clone(),
                            duration_seconds,
                            reason,
                        });

                    }
                    Ok(WsClientMessage::DeleteMessage { message_id, channel_id }) => {
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required to delete messages".to_string(),
                            }).await;
                            continue;
                        }
                      
                        let msg = message::Entity::find_by_id(message_id.clone())
                            .one(&state.db)
                            .await
                            .ok()
                            .flatten(); 

                        let Some(msg) = msg else { continue; };
                        let has_permission = user_has_permission(&state, &user_id, Permissions::MANAGE_MESSAGES).await.unwrap_or(false);
                        if msg.user_id != user_id && !has_permission {
                            continue;
                        }

                        let msg_channel_id = msg.channel_id.clone();

                        let mut active_msg: message::ActiveModel = msg.into();
                        active_msg.deleted_at = Set(Some(chrono::Utc::now()));
                        if let Err(e) = active_msg.update(&state.db).await {
                            tracing::error!("Failed to delete message: {e}");
                            continue;
                        }

                        let tx = state.get_channel_tx(&msg_channel_id);
                        let _ = tx.send(WsServerMessage::MessageDeleted {
                            id: message_id.clone(),
                            channel_id: channel_id.clone(),
                        });
                    }

                    Ok(WsClientMessage::EditMessage { message_id, content }) => {
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required to edit messages".to_string(),
                            }).await;
                            continue;
                        }

                        let content = content.trim().to_string();
                        if content.is_empty() || content.len() > MAX_MESSAGE_LENGTH {
                            continue;
                        }

                        let msg = message::Entity::find_by_id(message_id.clone())
                            .one(&state.db)
                            .await
                            .ok()
                            .flatten();

                        let Some(msg) = msg else { continue; };
                        let has_permission = user_has_permission(&state, &user_id, Permissions::MANAGE_MESSAGES).await.unwrap_or(false);
                        if msg.user_id != user_id && !has_permission {
                            continue; // Only allow editing own messages or users with MANAGE_MESSAGES permission
                        }

                        let msg_channel_id = msg.channel_id.clone();

                        let mut active_msg: message::ActiveModel = msg.into();
                        active_msg.content = Set(content.clone());
                        active_msg.edited_at = Set(Some(chrono::Utc::now()));
                        if let Err(e) = active_msg.update(&state.db).await {
                            tracing::error!("Failed to edit message: {e}");
                            continue;
                        }

                        let tx = state.get_channel_tx(&msg_channel_id);
                        let _ = tx.send(WsServerMessage::MessageEdited {
                            id: message_id.clone(),
                            content: content.clone(),
                            edited_at: chrono::Utc::now(),
                        });
                    }

                    Ok(WsClientMessage::TypingStart { channel_id }) => {
                        if !is_authenticated || channel_id.is_empty() {
                            continue;
                        }

                        if state.check_typing_limit(&channel_id, &user_id) {
                            let tx = state.get_channel_tx(&channel_id);
                            let _ = tx.send(WsServerMessage::TypingStart {
                                channel_id,
                                user_id: user_id.clone(),
                                user_name: user_name.clone(),
                            });
                        }
                    }

                    // ─── Voice signaling ───
                    Ok(WsClientMessage::JoinVoice { channel_id, .. }) => {
                        if !is_authenticated {
                            let _ = client_tx.send(WsServerMessage::Error {
                                message: "Authentication required for voice".to_string(),
                            }).await;
                            continue;
                        }
                        if channel_id.is_empty() {
                            continue;
                        }

                        voice_user_id = Some(user_id.clone());

                        if subscribed_channels.len() < MAX_SUBSCRIPTIONS && subscribed_channels.insert(channel_id.clone()) {
                            let tx = state.get_channel_tx(&channel_id);
                            let mut rx = tx.subscribe();
                            let client_tx = client_tx.clone();
                            let cid = channel_id.clone();
                            let uid = user_id.clone();

                            tokio::spawn(async move {
                                while let Ok(msg) = rx.recv().await {
                                    let should_send = match &msg {
                                        WsServerMessage::VoicePeerJoined { user_id, channel_id, .. } => {
                                            channel_id == &cid && user_id != &uid
                                        }
                                        WsServerMessage::VoicePeerLeft { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceMembers { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceTalking { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceStatusUpdate { channel_id, .. } => channel_id == &cid,
                                        WsServerMessage::VoiceOffer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::VoiceAnswer { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        WsServerMessage::IceCandidate { channel_id, target_user_id, .. } => channel_id == &cid && (target_user_id == &uid || target_user_id == "*"),
                                        _ => true,
                                    };
                                    if should_send {
                                        if client_tx.send(msg).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            });
                        }

                        let members = state.join_voice(&channel_id, &user_id, &user_name, false, false);

                        let _ = client_tx.send(WsServerMessage::VoiceMembers {
                            channel_id: channel_id.clone(),
                            members,
                        }).await;

                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoicePeerJoined {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoicePeerJoined {
                            channel_id,
                            user_id: user_id.clone(),
                            user_name: user_name.clone(),
                        });
                    }
                    Ok(WsClientMessage::LeaveVoice { channel_id, .. }) => {
                        state.leave_voice(&channel_id, &user_id);
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoicePeerLeft {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoicePeerLeft {
                            channel_id,
                            user_id: user_id.clone(),
                        });
                    }
                    Ok(WsClientMessage::VoiceOffer { channel_id, target_user_id, from_user_id: _, sdp }) => {
                        if sdp.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceOffer {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            sdp,
                        });
                    }
                    Ok(WsClientMessage::VoiceAnswer { channel_id, target_user_id, from_user_id: _, sdp }) => {
                        if sdp.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceAnswer {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            sdp,
                        });
                    }
                    Ok(WsClientMessage::IceCandidate { channel_id, target_user_id, from_user_id: _, candidate }) => {
                        if candidate.len() > MAX_SDP_LENGTH { continue; }
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::IceCandidate {
                            channel_id,
                            target_user_id,
                            from_user_id: user_id.clone(),
                            candidate,
                        });
                    }
                    Ok(WsClientMessage::VoiceTalking { channel_id, user_id: _, talking }) => {
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceTalking {
                            channel_id,
                            user_id: user_id.clone(),
                            talking,
                        });
                    }
                    Ok(WsClientMessage::VoiceStatusUpdate { channel_id, user_id: _, is_muted, is_deafened }) => {
                        state.update_voice_status(&channel_id, &user_id, is_muted, is_deafened);
                        let tx = state.get_channel_tx(&channel_id);
                        let _ = tx.send(WsServerMessage::VoiceStatusUpdate {
                            channel_id: channel_id.clone(),
                            user_id: user_id.clone(),
                            is_muted,
                            is_deafened,
                        });

                        // Global broadcast
                        let _ = state.global_tx.send(WsServerMessage::VoiceStatusUpdate {
                            channel_id,
                            user_id: user_id.clone(),
                            is_muted,
                            is_deafened,
                        });
                    }

                    Ok(WsClientMessage::Ping) => {
                        let _ = client_tx.send(WsServerMessage::Pong).await;
                    }
                    Err(_) => {
                        let _ = client_tx
                            .send(WsServerMessage::Error {
                                message: "Invalid message format".to_string(),
                            })
                            .await;
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    // Cleanup: remove from all voice channels on disconnect
    if voice_user_id.is_some() {
        let left = state.leave_all_voice(&user_id);
        for (channel_id, uid) in left {
            let tx = state.get_channel_tx(&channel_id);
            let _ = tx.send(WsServerMessage::VoicePeerLeft { channel_id: channel_id.clone(), user_id: uid.clone() });

            // Global broadcast
            let _ = state.global_tx.send(WsServerMessage::VoicePeerLeft { channel_id, user_id: uid });
        }
    }

    // Mark user/bot as offline
    state.user_offline(&user_id).await;

    state.dec_online();
    send_task.abort();
}
