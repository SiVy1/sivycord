use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_peers")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub shared_secret: String,
    pub status: String,
    pub direction: String,
    pub created_at: String,
    pub last_seen: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::federated_channel::Entity")]
    FederatedChannel,
}

impl Related<super::federated_channel::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::FederatedChannel.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
