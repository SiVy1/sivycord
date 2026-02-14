use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federated_channels")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub local_channel_id: String,
    pub peer_id: String,
    pub remote_channel_id: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::federation_peer::Entity",
        from = "Column::PeerId",
        to = "super::federation_peer::Column::Id"
    )]
    FederationPeer,
    #[sea_orm(
        belongs_to = "super::channel::Entity",
        from = "Column::LocalChannelId",
        to = "super::channel::Column::Id"
    )]
    Channel,
}

impl Related<super::federation_peer::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::FederationPeer.def()
    }
}

impl Related<super::channel::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Channel.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
