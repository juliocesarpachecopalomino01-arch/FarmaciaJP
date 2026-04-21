import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { usersApi, User, CreateUserRequest, UserPermissions } from '../api/users';
import { MODULES } from '../constants/modules';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import './Users.css';

export default function Users() {
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editPermissions, setEditPermissions] = useState<UserPermissions>({});
  const [createForm, setCreateForm] = useState<CreateUserRequest>({
    username: '',
    email: '',
    password: '',
    full_name: '',
    role: 'employee',
    permissions: MODULES.map((m) => m.key),
  });
  const [editForm, setEditForm] = useState({ full_name: '', email: '', role: 'employee' as string, is_active: true });

  const queryClient = useQueryClient();

  const { data: users } = useQuery('users', usersApi.getAll, {
    enabled: user?.role === 'admin',
  });

  const createMutation = useMutation(usersApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('users');
      setShowCreateModal(false);
      setCreateForm({ username: '', email: '', password: '', full_name: '', role: 'employee', permissions: MODULES.map((m) => m.key) });
    },
  });

  const updateMutation = useMutation(
    (data: { id: number; full_name?: string; email?: string; role?: string; is_active?: boolean }) =>
      usersApi.update(data.id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('users');
      },
    }
  );

  const permissionsMutation = useMutation(
    (data: { id: number; permissions: UserPermissions }) => usersApi.updatePermissions(data.id, data.permissions),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('users');
      },
    }
  );

  const deleteMutation = useMutation(usersApi.delete, {
    onSuccess: () => {
      queryClient.invalidateQueries('users');
      setShowEditModal(false);
      setEditingUser(null);
    },
  });

  const openEditModal = async (u: User) => {
    setEditingUser(u);
    setEditForm({ full_name: u.full_name, email: u.email, role: u.role, is_active: !!u.is_active });
    const perms = await usersApi.getPermissions(u.id);
    setEditPermissions(perms);
    setShowEditModal(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.username || !createForm.email || !createForm.password || !createForm.full_name) {
      alert('Complete todos los campos');
      return;
    }
    createMutation.mutate(createForm);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    updateMutation.mutate({
      id: editingUser.id,
      full_name: editForm.full_name,
      email: editForm.email,
      role: editForm.role,
      is_active: editForm.is_active,
    });
    if (editForm.role === 'employee') {
      permissionsMutation.mutate({ id: editingUser.id, permissions: editPermissions });
    }
    setShowEditModal(false);
    setEditingUser(null);
  };

  if (user?.role !== 'admin') {
    return (
      <div className="page-container">
        <div className="info-message">
          <p>No tiene permisos para acceder a esta sección.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Usuarios</h1>
          <p>Gestión de usuarios y permisos por módulo</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
          <Plus size={20} />
          Nuevo Usuario
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Nombre Completo</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.full_name}</td>
                <td>{u.email}</td>
                <td>
                  <span className="badge badge-normal">{u.role}</span>
                </td>
                <td>
                  <span className={u.is_active ? 'badge badge-success' : 'badge badge-warning'}>
                    {u.is_active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      onClick={() => openEditModal(u)}
                      className="btn-icon"
                      title="Editar"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (u.id === user?.id) {
                          alert('No puede desactivar su propia cuenta');
                          return;
                        }
                        if (window.confirm('¿Está seguro de desactivar este usuario?')) {
                          deleteMutation.mutate(u.id);
                        }
                      }}
                      className="btn-icon btn-danger"
                      disabled={u.id === user?.id}
                      title="Desactivar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo Usuario</h2>
            <form onSubmit={handleCreateSubmit}>
              <div className="form-group">
                <label>Usuario *</label>
                <input
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Nombre Completo *</label>
                <input
                  value={createForm.full_name}
                  onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Contraseña *</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                  minLength={6}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div className="form-group">
                <label>Rol</label>
                <select
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as 'admin' | 'employee' })}
                >
                  <option value="employee">Empleado</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              {createForm.role === 'employee' && (
                <div className="form-group">
                  <label>Permisos por módulo</label>
                  <div className="permissions-grid">
                    {MODULES.filter((m) => m.key !== 'users').map((mod) => (
                      <label key={mod.key} className="permission-checkbox">
                        <input
                          type="checkbox"
                          checked={(createForm.permissions || []).includes(mod.key)}
                          onChange={(e) => {
                            const perms = createForm.permissions || [];
                            if (e.target.checked) {
                              setCreateForm({ ...createForm, permissions: [...perms, mod.key] });
                            } else {
                              setCreateForm({ ...createForm, permissions: perms.filter((p) => p !== mod.key) });
                            }
                          }}
                        />
                        {mod.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={createMutation.isLoading}>
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && editingUser && (
        <div className="modal-overlay" onClick={() => { setShowEditModal(false); setEditingUser(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Editar Usuario - {editingUser.username}</h2>
            <form onSubmit={handleEditSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre Completo *</label>
                  <input
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Rol</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    <option value="employee">Empleado</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select
                    value={editForm.is_active ? '1' : '0'}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.value === '1' })}
                  >
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
              </div>
              {editForm.role === 'employee' && (
                <div className="form-group">
                  <label>Permisos por módulo</label>
                  <div className="permissions-grid">
                    {MODULES.filter((m) => m.key !== 'users').map((mod) => (
                      <label key={mod.key} className="permission-checkbox">
                        <input
                          type="checkbox"
                          checked={editPermissions[mod.key] !== false}
                          onChange={(e) =>
                            setEditPermissions({ ...editPermissions, [mod.key]: e.target.checked })
                          }
                        />
                        {mod.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowEditModal(false); setEditingUser(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={updateMutation.isLoading}>
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
