const TOKEN_KEY = 'typeroom.sessionToken';
const USERNAME_KEY = 'typeroom.username';

export const session = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  getUsername: () => localStorage.getItem(USERNAME_KEY) ?? '',
  setUsername: (username: string) => localStorage.setItem(USERNAME_KEY, username),
};
