use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "categories")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub server_id: String,
    #[sea_orm(default_value = 0)]
    pub position: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::channel::Entity")]
    Channel,
    #[sea_orm(
        belongs_to = "super::server::Entity",
        from = "Column::ServerId",
        to = "super::server::Column::Id",
        on_delete = "Cascade"
    )]
    Server,
}

impl Related<super::channel::Entity> for Entity {
    fn to() -> sea_orm::RelationDef {
        Relation::Channel.def()
    }
}

impl Related<super::server::Entity> for Entity {
    fn to() -> sea_orm::RelationDef {
        Relation::Server.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}