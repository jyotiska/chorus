from enum import Enum
from typing import List, Optional
import os
import yaml


class Archetype(Enum):
    """Defines the core personality archetypes for agents."""
    LEADER = "leader"
    ANALYTICAL = "analytical"
    CREATIVE = "creative"
    SUPPORT = "support"
    CONTRARIAN = "contrarian"


class Personality:
    """Represents an agent's personality configuration."""
    
    _config_cache: Optional[dict] = None
    _config_file_path: Optional[str] = None
    
    def __init__(
        self,
        name: str,
        archetype: Archetype,
        traits: List[str],
        description: str
    ):
        """
        Initialize a personality.
        
        Args:
            name: The name of this personality
            archetype: The archetype enum value
            traits: List of trait strings (e.g., ["decisive", "confident"])
            description: A detailed description of the personality
        """
        self.name = name
        self.archetype = archetype
        self.traits = traits
        self.description = description
    
    @classmethod
    def _load_config(cls, config_path: Optional[str] = None) -> dict:
        """
        Load the personalities configuration file.
        
        Args:
            config_path: Optional path to config file. If None, uses default location.
            
        Returns:
            Dictionary containing personality configurations
            
        Raises:
            FileNotFoundError: If config file doesn't exist
            ValueError: If config file is invalid
        """
        if config_path is None:
            # Default to personalities.yaml in the same directory as this file
            current_dir = os.path.dirname(os.path.abspath(__file__))
            config_path = os.path.join(current_dir, "personalities.yaml")
        
        # Use cache if same file and already loaded
        if cls._config_cache is not None and cls._config_file_path == config_path:
            return cls._config_cache
        
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Personality config file not found: {config_path}")
        
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            if not config or 'personalities' not in config:
                raise ValueError("Invalid config file: missing 'personalities' key")
            
            # Cache the loaded config
            cls._config_cache = config
            cls._config_file_path = config_path
            
            return config
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in config file: {e}") from e
    
    @classmethod
    def from_config(cls, personality_key: str, config_path: Optional[str] = None) -> "Personality":
        """
        Create a Personality instance from configuration file.
        
        Args:
            personality_key: The key identifying the personality in the config file
            config_path: Optional path to config file. If None, uses default location.
            
        Returns:
            A Personality instance
            
        Raises:
            KeyError: If personality_key not found in config
            ValueError: If personality configuration is invalid
        """
        config = cls._load_config(config_path)
        
        if personality_key not in config['personalities']:
            available = cls.list_available_personalities(config_path)
            raise KeyError(
                f"Personality '{personality_key}' not found. "
                f"Available personalities: {', '.join(available)}"
            )
        
        personality_data = config['personalities'][personality_key]
        
        # Validate required fields
        required_fields = ['name', 'archetype', 'traits', 'description']
        for field in required_fields:
            if field not in personality_data:
                raise ValueError(
                    f"Invalid personality config for '{personality_key}': missing '{field}'"
                )
        
        # Convert archetype string to enum
        try:
            archetype = Archetype[personality_data['archetype'].upper()]
        except KeyError as e:
            valid_archetypes = [a.name for a in Archetype]
            raise ValueError(
                f"Invalid archetype '{personality_data['archetype']}' for '{personality_key}'. "
                f"Valid archetypes: {', '.join(valid_archetypes)}"
            ) from e
        
        return cls(
            name=personality_data['name'],
            archetype=archetype,
            traits=personality_data['traits'],
            description=personality_data['description']
        )
    
    @classmethod
    def list_available_personalities(cls, config_path: Optional[str] = None) -> List[str]:
        """
        List all available personality keys from the configuration file.
        
        Args:
            config_path: Optional path to config file. If None, uses default location.
            
        Returns:
            List of personality keys
        """
        config = cls._load_config(config_path)
        return list(config['personalities'].keys())
    
    def generate_personality_prompt(self) -> str:
        """
        Generate a personality prompt for the LLM.
        
        Returns:
            A natural language prompt describing this personality
        """
        traits_str = ", ".join(self.traits)
        
        prompt = f"""You are embodying the '{self.name}' personality.

Archetype: {self.archetype.value.upper()}

Core Traits: {traits_str}

Description: {self.description}

Embody these characteristics in your responses and decision-making. Let your {self.archetype.value} nature guide your contributions while maintaining your unique traits."""
        
        return prompt
    
    def __repr__(self) -> str:
        return f"Personality(name='{self.name}', archetype={self.archetype.value})"

