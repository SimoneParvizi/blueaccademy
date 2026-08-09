from pydantic import BaseModel, ConfigDict, Field


class DeckRename(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1)


class DeckTrackUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    track: str = Field(min_length=1)
