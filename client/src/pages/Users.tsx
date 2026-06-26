import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { usersApi, User, Worker, UserProfile, CreateUserRequest, UserPermissions } from '../api/users';
import { MODULES } from '../constants/modules';
import { Plus, Edit, Trash2, UserCog, Briefcase, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import './Users.css';

type Tab = 'users' | 'workers' | 'profiles';

const emptyPermissions = () => MODULES.reduce<UserPermissions>((acc, mod) => {
  acc[mod.key] = mod.key !== 'users' && mod.key !== 'company-settings';
  return acc;
}, {});

const emptyWorker = {
  document_type: 'DNI',
  document_number: '',
  full_name: '',
  email: '',
  phone: '',
  address: '',
  position: '',
  hire_date: '',
  is_active: true,
};

const emptyProfile = {
  name: '',
  description: '',
  role: 'employee' as 'admin' | 'employee',
  is_active: true,
  permissions: emptyPermissions(),
};

export default function Users() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const [userModal, setUserModal] = useState(false);
  const [workerModal, setWorkerModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [editingProfile, setEditingProfile] = useState<UserProfile | null>(null);
  const [editPermissions, setEditPermissions] = useState<UserPermissions>({});

  const [userForm, setUserForm] = useState<CreateUserRequest>({
    username: '',
    password: '',
    worker_id: '',
    profile_id: '',
  });
  const [editUserForm, setEditUserForm] = useState({ worker_id: '', profile_id: '', is_active: true });
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [workerForm, setWorkerForm] = useState({ ...emptyWorker });
  const [profileForm, setProfileForm] = useState({ ...emptyProfile });

  const { data: users } = useQuery('users', usersApi.getAll, { enabled: user?.role === 'admin' });
  const { data: workers } = useQuery('workers', usersApi.getWorkers, { enabled: user?.role === 'admin' });
  const { data: profiles } = useQuery('user-profiles', usersApi.getProfiles, { enabled: user?.role === 'admin' });

  const refreshAll = () => {
    queryClient.invalidateQueries('users');
    queryClient.invalidateQueries('workers');
    queryClient.invalidateQueries('user-profiles');
  };

  const availableWorkers = useMemo(() => {
    const editingWorkerId = editingUser?.worker_id;
    return (workers || []).filter((worker) => Number(worker.is_active) === 1 || worker.is_active === true)
      .filter((worker) => !worker.user_id || worker.id === editingWorkerId);
  }, [workers, editingUser]);

  const activeProfiles = useMemo(() => (
    (profiles || []).filter((profile) => Number(profile.is_active) === 1 || profile.is_active === true)
  ), [profiles]);

  const createUserMutation = useMutation(usersApi.create, {
    onSuccess: () => {
      refreshAll();
      setUserModal(false);
      setUserForm({ username: '', password: '', worker_id: '', profile_id: '' });
    },
    onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo crear el usuario'),
  });

  const updateUserMutation = useMutation(
    (payload: { id: number; data: Partial<User> }) => usersApi.update(payload.id, payload.data),
    {
      onSuccess: () => {
        refreshAll();
        setUserModal(false);
        setEditingUser(null);
      },
      onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo actualizar el usuario'),
    }
  );

  const changePasswordMutation = useMutation(
    (payload: { id: number; data: { current_password?: string; new_password: string } }) =>
      usersApi.changePassword(payload.id, payload.data),
    {
      onSuccess: () => {
        setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
        alert('Contraseña actualizada correctamente');
      },
      onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo actualizar la contraseña'),
    }
  );

  const createWorkerMutation = useMutation(usersApi.createWorker, {
    onSuccess: () => {
      refreshAll();
      setWorkerModal(false);
      setWorkerForm({ ...emptyWorker });
    },
    onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo crear el trabajador'),
  });

  const updateWorkerMutation = useMutation(
    (payload: { id: number; data: Partial<Worker> }) => usersApi.updateWorker(payload.id, payload.data),
    {
      onSuccess: () => {
        refreshAll();
        setWorkerModal(false);
        setEditingWorker(null);
      },
      onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo actualizar el trabajador'),
    }
  );

  const createProfileMutation = useMutation(usersApi.createProfile, {
    onSuccess: () => {
      refreshAll();
      setProfileModal(false);
      setProfileForm({ ...emptyProfile, permissions: emptyPermissions() });
    },
    onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo crear el perfil'),
  });

  const updateProfileMutation = useMutation(
    (payload: { id: number; data: Partial<UserProfile> }) => usersApi.updateProfile(payload.id, payload.data),
    {
      onSuccess: () => {
        refreshAll();
        setProfileModal(false);
        setEditingProfile(null);
      },
      onError: (error: any) => alert(error?.response?.data?.error || 'No se pudo actualizar el perfil'),
    }
  );

  const deleteUserMutation = useMutation(usersApi.delete, { onSuccess: refreshAll });
  const deleteWorkerMutation = useMutation(usersApi.deleteWorker, { onSuccess: refreshAll });
  const deleteProfileMutation = useMutation(usersApi.deleteProfile, { onSuccess: refreshAll });
  const permissionsMutation = useMutation(
    (payload: { id: number; permissions: UserPermissions }) => usersApi.updatePermissions(payload.id, payload.permissions),
    { onSuccess: refreshAll }
  );

  const openCreateUser = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', worker_id: '', profile_id: activeProfiles[0]?.id || '' });
    setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    setEditPermissions({});
    setUserModal(true);
  };

  const openEditUser = async (item: User) => {
    setEditingUser(item);
    setEditUserForm({
      worker_id: item.worker_id ? String(item.worker_id) : '',
      profile_id: item.profile_id ? String(item.profile_id) : '',
      is_active: item.is_active === true || Number(item.is_active) === 1,
    });
    setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    setEditPermissions(await usersApi.getPermissions(item.id));
    setUserModal(true);
  };

  const openCreateWorker = () => {
    setEditingWorker(null);
    setWorkerForm({ ...emptyWorker });
    setWorkerModal(true);
  };

  const openEditWorker = (item: Worker) => {
    setEditingWorker(item);
    setWorkerForm({
      document_type: item.document_type || 'DNI',
      document_number: item.document_number || '',
      full_name: item.full_name || '',
      email: item.email || '',
      phone: item.phone || '',
      address: item.address || '',
      position: item.position || '',
      hire_date: item.hire_date ? item.hire_date.slice(0, 10) : '',
      is_active: item.is_active === true || Number(item.is_active) === 1,
    });
    setWorkerModal(true);
  };

  const openCreateProfile = () => {
    setEditingProfile(null);
    setProfileForm({ ...emptyProfile, permissions: emptyPermissions() });
    setProfileModal(true);
  };

  const openEditProfile = (item: UserProfile) => {
    setEditingProfile(item);
    setProfileForm({
      name: item.name,
      description: item.description || '',
      role: item.role,
      is_active: item.is_active === true || Number(item.is_active) === 1,
      permissions: item.permissions || emptyPermissions(),
    });
    setProfileModal(true);
  };

  const handleChangeUserPassword = () => {
    if (!editingUser) return;
    if (editingUser.id === user?.id && !passwordForm.current_password.trim()) {
      alert('Ingrese la contraseña actual');
      return;
    }
    if (passwordForm.new_password.length < 6) {
      alert('La nueva contraseña debe tener al menos 6 caracteres');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      alert('La confirmación no coincide con la nueva contraseña');
      return;
    }

    changePasswordMutation.mutate({
      id: editingUser.id,
      data: {
        current_password: editingUser.id === user?.id ? passwordForm.current_password : undefined,
        new_password: passwordForm.new_password,
      },
    });
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
          <p>Trabajadores, perfiles y accesos al sistema</p>
        </div>
        <button className="btn-primary" onClick={activeTab === 'workers' ? openCreateWorker : activeTab === 'profiles' ? openCreateProfile : openCreateUser}>
          <Plus size={20} />
          {activeTab === 'workers' ? 'Nuevo Trabajador' : activeTab === 'profiles' ? 'Nuevo Perfil' : 'Nuevo Usuario'}
        </button>
      </div>

      <div className="tabs-container user-tabs">
        <button className={`tab-button ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
          <UserCog size={18} /> Usuarios
        </button>
        <button className={`tab-button ${activeTab === 'workers' ? 'active' : ''}`} onClick={() => setActiveTab('workers')}>
          <Briefcase size={18} /> Trabajadores
        </button>
        <button className={`tab-button ${activeTab === 'profiles' ? 'active' : ''}`} onClick={() => setActiveTab('profiles')}>
          <ShieldCheck size={18} /> Perfiles
        </button>
      </div>

      {activeTab === 'users' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Trabajador</th>
                <th>Perfil</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(users || []).map((item) => (
                <tr key={item.id}>
                  <td>{item.username}</td>
                  <td>
                    <strong>{item.worker_name || item.full_name}</strong>
                    <div className="muted">{item.document_number || '-'}</div>
                  </td>
                  <td>
                    <span className="badge badge-normal">{item.profile_name || item.role}</span>
                  </td>
                  <td>{item.email}</td>
                  <td>
                    <span className={Number(item.is_active) === 1 || item.is_active === true ? 'badge badge-success' : 'badge badge-warning'}>
                      {Number(item.is_active) === 1 || item.is_active === true ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button onClick={() => openEditUser(item)} className="btn-icon" title="Editar usuario"><Edit size={16} /></button>
                      <button
                        onClick={() => {
                          if (item.id === user?.id) return alert('No puede desactivar su propia cuenta');
                          if (window.confirm('¿Está seguro de desactivar este usuario?')) deleteUserMutation.mutate(item.id);
                        }}
                        className="btn-icon btn-danger"
                        disabled={item.id === user?.id}
                        title="Desactivar usuario"
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
      )}

      {activeTab === 'workers' && (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>Documento</th>
                <th>Contacto</th>
                <th>Cargo</th>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(workers || []).map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.full_name}</strong></td>
                  <td>{item.document_type || 'DNI'} {item.document_number || '-'}</td>
                  <td>
                    <div>{item.email || '-'}</div>
                    <div className="muted">{item.phone || ''}</div>
                  </td>
                  <td>{item.position || '-'}</td>
                  <td>{item.username ? <span className="badge badge-normal">{item.username}</span> : '-'}</td>
                  <td>
                    <span className={Number(item.is_active) === 1 || item.is_active === true ? 'badge badge-success' : 'badge badge-warning'}>
                      {Number(item.is_active) === 1 || item.is_active === true ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button onClick={() => openEditWorker(item)} className="btn-icon" title="Editar trabajador"><Edit size={16} /></button>
                      <button
                        onClick={() => {
                          if (window.confirm('¿Está seguro de desactivar este trabajador?')) deleteWorkerMutation.mutate(item.id);
                        }}
                        className="btn-icon btn-danger"
                        disabled={!!item.user_id}
                        title={item.user_id ? 'No se puede desactivar si tiene usuario vinculado' : 'Desactivar trabajador'}
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
      )}

      {activeTab === 'profiles' && (
        <div className="profiles-grid">
          {(profiles || []).map((profile) => (
            <div className="profile-card" key={profile.id}>
              <div>
                <h3>{profile.name}</h3>
                <p>{profile.description || 'Sin descripción'}</p>
              </div>
              <div className="profile-meta">
                <span className="badge badge-normal">{profile.role === 'admin' ? 'Administrador' : 'Empleado'}</span>
                <span className={Number(profile.is_active) === 1 || profile.is_active === true ? 'badge badge-success' : 'badge badge-warning'}>
                  {Number(profile.is_active) === 1 || profile.is_active === true ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <div className="profile-permissions">
                {MODULES.filter((module) => profile.permissions?.[module.key] !== false).slice(0, 6).map((module) => (
                  <span key={module.key}>{module.label}</span>
                ))}
              </div>
              <div className="profile-actions">
                <button className="btn-secondary" onClick={() => openEditProfile(profile)}>
                  <Edit size={16} /> Editar
                </button>
                <button
                  className="btn-secondary btn-danger"
                  disabled={profile.id === 1}
                  onClick={() => {
                    if (window.confirm('¿Está seguro de desactivar este perfil?')) deleteProfileMutation.mutate(profile.id);
                  }}
                >
                  <Trash2 size={16} /> Desactivar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {userModal && (
        <div className="modal-overlay" onClick={() => { setUserModal(false); setEditingUser(null); setPasswordForm({ current_password: '', new_password: '', confirm_password: '' }); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>{editingUser ? `Editar Usuario - ${editingUser.username}` : 'Nuevo Usuario'}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editingUser) {
                  updateUserMutation.mutate({
                    id: editingUser.id,
                    data: {
                      worker_id: Number(editUserForm.worker_id) || undefined,
                      profile_id: Number(editUserForm.profile_id) || undefined,
                      is_active: editUserForm.is_active,
                    },
                  });
                  permissionsMutation.mutate({ id: editingUser.id, permissions: editPermissions });
                  return;
                }
                if (!userForm.worker_id || !userForm.profile_id || !userForm.username || !userForm.password) {
                  alert('Complete trabajador, perfil, usuario y contraseña');
                  return;
                }
                createUserMutation.mutate({
                  ...userForm,
                  worker_id: Number(userForm.worker_id),
                  profile_id: Number(userForm.profile_id),
                });
              }}
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Trabajador *</label>
                  <select
                    value={editingUser ? editUserForm.worker_id : userForm.worker_id}
                    onChange={(e) => editingUser
                      ? setEditUserForm({ ...editUserForm, worker_id: e.target.value })
                      : setUserForm({ ...userForm, worker_id: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar trabajador...</option>
                    {availableWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>{worker.full_name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Perfil *</label>
                  <select
                    value={editingUser ? editUserForm.profile_id : userForm.profile_id}
                    onChange={(e) => editingUser
                      ? setEditUserForm({ ...editUserForm, profile_id: e.target.value })
                      : setUserForm({ ...userForm, profile_id: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar perfil...</option>
                    {activeProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {!editingUser && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Usuario *</label>
                    <input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Contraseña *</label>
                    <input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} minLength={6} required />
                  </div>
                </div>
              )}
              {editingUser && (
                <>
                  <div className="form-group">
                    <label>Estado</label>
                    <select value={editUserForm.is_active ? '1' : '0'} onChange={(e) => setEditUserForm({ ...editUserForm, is_active: e.target.value === '1' })}>
                      <option value="1">Activo</option>
                      <option value="0">Inactivo</option>
                    </select>
                  </div>
                  <div className="password-panel">
                    <div className="password-panel-header">
                      <strong>Cambiar contraseña</strong>
                      <span>Dejar en blanco si no deseas cambiarla.</span>
                    </div>
                    {editingUser.id === user?.id && (
                      <div className="form-group">
                        <label>Contraseña actual *</label>
                        <input
                          type="password"
                          value={passwordForm.current_password}
                          onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                          autoComplete="current-password"
                        />
                      </div>
                    )}
                    <div className="form-row">
                      <div className="form-group">
                        <label>Nueva contraseña</label>
                        <input
                          type="password"
                          value={passwordForm.new_password}
                          onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                          minLength={6}
                          autoComplete="new-password"
                          placeholder="Mínimo 6 caracteres"
                        />
                      </div>
                      <div className="form-group">
                        <label>Confirmar contraseña</label>
                        <input
                          type="password"
                          value={passwordForm.confirm_password}
                          onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                          minLength={6}
                          autoComplete="new-password"
                          placeholder="Repetir contraseña"
                        />
                      </div>
                    </div>
                    <div className="password-panel-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleChangeUserPassword}
                        disabled={changePasswordMutation.isLoading || !passwordForm.new_password || !passwordForm.confirm_password}
                      >
                        {changePasswordMutation.isLoading ? 'Actualizando...' : 'Actualizar contraseña'}
                      </button>
                    </div>
                  </div>
                  <PermissionsEditor permissions={editPermissions} onChange={setEditPermissions} />
                </>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setUserModal(false); setEditingUser(null); setPasswordForm({ current_password: '', new_password: '', confirm_password: '' }); }}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={createUserMutation.isLoading || updateUserMutation.isLoading}>Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {workerModal && (
        <div className="modal-overlay" onClick={() => { setWorkerModal(false); setEditingWorker(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>{editingWorker ? 'Editar Trabajador' : 'Nuevo Trabajador'}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!workerForm.full_name) return alert('Ingrese el nombre del trabajador');
                if (editingWorker) updateWorkerMutation.mutate({ id: editingWorker.id, data: workerForm });
                else createWorkerMutation.mutate(workerForm);
              }}
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre completo *</label>
                  <input value={workerForm.full_name} onChange={(e) => setWorkerForm({ ...workerForm, full_name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Cargo</label>
                  <input value={workerForm.position} onChange={(e) => setWorkerForm({ ...workerForm, position: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo documento</label>
                  <select value={workerForm.document_type} onChange={(e) => setWorkerForm({ ...workerForm, document_type: e.target.value })}>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="RUC">RUC</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Número documento</label>
                  <input value={workerForm.document_number} onChange={(e) => setWorkerForm({ ...workerForm, document_number: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={workerForm.email} onChange={(e) => setWorkerForm({ ...workerForm, email: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input value={workerForm.phone} onChange={(e) => setWorkerForm({ ...workerForm, phone: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dirección</label>
                  <input value={workerForm.address} onChange={(e) => setWorkerForm({ ...workerForm, address: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Fecha ingreso</label>
                  <input type="date" value={workerForm.hire_date} onChange={(e) => setWorkerForm({ ...workerForm, hire_date: e.target.value })} />
                </div>
              </div>
              {editingWorker && (
                <div className="form-group">
                  <label>Estado</label>
                  <select value={workerForm.is_active ? '1' : '0'} onChange={(e) => setWorkerForm({ ...workerForm, is_active: e.target.value === '1' })}>
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setWorkerModal(false); setEditingWorker(null); }}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={createWorkerMutation.isLoading || updateWorkerMutation.isLoading}>Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {profileModal && (
        <div className="modal-overlay" onClick={() => { setProfileModal(false); setEditingProfile(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>{editingProfile ? 'Editar Perfil' : 'Nuevo Perfil'}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!profileForm.name) return alert('Ingrese el nombre del perfil');
                const payload = { ...profileForm };
                if (profileForm.role === 'admin') {
                  payload.permissions = MODULES.reduce<UserPermissions>((acc, mod) => ({ ...acc, [mod.key]: true }), {});
                }
                if (editingProfile) updateProfileMutation.mutate({ id: editingProfile.id, data: payload });
                else createProfileMutation.mutate(payload);
              }}
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre del perfil *</label>
                  <input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Tipo de acceso</label>
                  <select value={profileForm.role} onChange={(e) => setProfileForm({ ...profileForm, role: e.target.value as 'admin' | 'employee' })}>
                    <option value="employee">Empleado</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea value={profileForm.description} onChange={(e) => setProfileForm({ ...profileForm, description: e.target.value })} rows={3} />
              </div>
              {editingProfile && (
                <div className="form-group">
                  <label>Estado</label>
                  <select value={profileForm.is_active ? '1' : '0'} onChange={(e) => setProfileForm({ ...profileForm, is_active: e.target.value === '1' })}>
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
              )}
              {profileForm.role === 'employee' && (
                <PermissionsEditor
                  permissions={profileForm.permissions || {}}
                  onChange={(permissions) => setProfileForm({ ...profileForm, permissions })}
                />
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setProfileModal(false); setEditingProfile(null); }}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={createProfileMutation.isLoading || updateProfileMutation.isLoading}>Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function PermissionsEditor({ permissions, onChange }: { permissions: UserPermissions; onChange: (permissions: UserPermissions) => void }) {
  return (
    <div className="form-group">
      <label>Permisos por módulo</label>
      <div className="permissions-grid">
        {MODULES.filter((module) => module.key !== 'users').map((module) => (
          <label key={module.key} className="permission-checkbox">
            <input
              type="checkbox"
              checked={permissions[module.key] !== false}
              onChange={(e) => onChange({ ...permissions, [module.key]: e.target.checked })}
            />
            {module.label}
          </label>
        ))}
      </div>
    </div>
  );
}
